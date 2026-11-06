import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { toolDefs, runTool, catalog } from './tools.js';
import { schemaHint } from './generic.js';
import { calendarHint, nowParts } from './dates.js';

// Histórico curto por chat (só texto), para entender "e coloca peso 2 nela".
const history = new Map();
const MAX_TURNS = 12;
const MAX_STEPS = 8;
const TIMEOUT_MS = 25_000;
const AUDIO_TIMEOUT_MS = 60_000;

async function systemPrompt() {
  const { date, time } = nowParts();
  const [{ materias, projetos, livros }, bases] = await Promise.all([catalog(), schemaHint()]);
  const dono = config.ownerName ? `de ${config.ownerName}` : 'do usuário';
  const instituicao = config.institution ? ` e Instituição ${config.institution} se ele não disser outra` : '';
  return `Você é o assistente pessoal ${dono} no WhatsApp. Ele manda mensagens curtas e informais e você registra tudo no Notion dele (Campelo Brain) usando as ferramentas.

Agora: ${date} ${time} (${config.tz}).
Calendário para converter dias da semana em datas:
${calendarHint(date)}
"Segunda" sem mais nada = a próxima segunda a partir de hoje (se hoje for segunda, é hoje só se ele disser "hoje").

Matérias cursando: ${materias.map((m) => m.name).join(', ') || 'nenhuma'}
Projetos: ${projetos.map((p) => p.name).join(', ') || 'nenhum'}
Livros: ${livros.map((l) => `${l.name} (${l.status})`).join(', ') || 'nenhum'}

Bases do Notion e seus campos (para criar_item, editar_item, buscar_itens, ler_item, apagar_item):
${bases}

Como agir
- Você tem liberdade total sobre essas bases. Se ele pedir algo que as ferramentas específicas não cobrem (matéria ou projeto novo, mudar data, renomear, apagar, consultar anotações, comprar recompensa), use as ferramentas genéricas. Nunca diga que não consegue sem antes tentar com elas.
- Perguntas sobre o que ele anotou ou registrou ("o que anotei de SO sobre escalonamento?") se respondem com pesquisa: use pesquisar com o termo, ou buscar_itens na base notas filtrando pela matéria e depois ler_item. Responda com um resumo do que está nas páginas e o link. Nunca invente conteúdo; se não achar nada, diga que não achou.
- Para editar ou apagar algo, se não tiver certeza do título exato, use buscar_itens antes.
- Matéria nova entra com Status Cursando${instituicao}.
- Execute direto. Não peça confirmação para coisas óbvias. Só pergunte se faltar algo que impede registrar (ex: matéria ambígua).
- Na dúvida de verdade, não chame ferramenta de escrita: responda só com uma pergunta curta e opções numeradas (1, 2). Vale quando a data for ambígua, o valor ou a categoria de um recibo estiver ilegível, ou a matéria puder ser mais de uma. A próxima mensagem dele (ex: "2") responde a essa pergunta: use o histórico e registre.
- Se uma ferramenta devolver ok false com o campo duvida, nada foi salvo. Transforme em pergunta curta ao usuário, com opções numeradas quando houver opcoes (matéria ambígua) ou a data/valor em questão (data no passado, valor ausente). Nunca ignore isso nem repita a chamada com chute. Depois da resposta dele, chame a ferramenta de novo com o dado certo (para data no passado confirmada, passe confirmado true).
- Uma mensagem pode ter várias ações. Chame todas as ferramentas necessárias.
- "nota de X: prova segunda" significa avaliação da matéria X, não uma anotação. "Nota" com número ("tirei 8") é lançar nota.
- "anota", conteúdo de aula, ideia ou resumo vira criar_nota.
- Gastos ("gastei 30 no ifood") viram lançamento financeiro. Recebimentos de cliente da agência são categoria ${config.workArea}.
- Compromisso com horário ("cortar o cabelo às 15h", reunião, consulta) vira criar_evento: salva no Notion, manda o arquivo de calendário e o bot avisa antes. Avise que é só tocar no arquivo para entrar no Calendário. Tarefa comum com horário usa criar_tarefa com hora.
- Tarefa que se repete usa o parâmetro repetir (Diária, Dias úteis, Semanal, Mensal) em criar_tarefa ou criar_evento, com o prazo na próxima ocorrência. "Toda segunda pagar a academia" vira tarefa com prazo na próxima segunda e repetir Semanal. "Todo dia 5 pagar aluguel" vira Mensal com prazo no próximo dia 5. Ao concluir, o bot cria a próxima sozinho.
- Foto de recibo, nota fiscal ou comprovante de pagamento vira lançamento_financeiro. Descrição é o nome do lugar (curto, ex: "Mercado Atacadão"). Valor é o total pago. Categoria você deduz do tipo de lugar. Data é a do comprovante se estiver legível (ISO, ano atual se faltar), senão hoje. Comprovante de Pix recebido é Entrada. Se vierem várias notas na mesma foto, lance uma por uma. Se não der para ler o valor, pergunte.
- Foto de quadro, caderno ou slide vira criar_nota tipo Aula, com o conteúdo transcrito e organizado. Foto de cronograma ou lista de datas vira criar_avaliacao para cada item.
- Mensagem que começa com [áudio transcrito] é a transcrição de um áudio dele (pode ter erros de reconhecimento). Execute como se ele tivesse escrito. Comece a resposta com 🎙️ e o que você entendeu entre aspas, curto, e depois a confirmação. Se a transcrição não fizer sentido, peça para repetir.
- Mensagem marcada como encaminhada foi escrita por outra pessoa. Se for pedido ou demanda (cliente, professor, grupo), crie uma tarefa com título curto e prazo se houver, área ${config.workArea} se for cliente ou trabalho, Faculdade se for aula ou turma. Aviso de prova ou trabalho vira criar_avaliacao. Texto informativo vira criar_nota. Comprovante vira lançamento. Confirme em uma linha o que fez.
- "Anota no diário que..." ou um relato do dia que ele queira guardar vira escrever_diario. Não confunda com criar_nota (estudo, ideias) nem com hábitos.
- "fui na academia", "treinei" marca treino. "li 20 páginas" registra leitura. "acordei cedo" marca acordar.
- Se uma ferramenta devolver erro, tente corrigir uma vez (ex: usar o nome certo da matéria). Se não der, explique em uma linha.
- Nunca diga que salvou algo sem ter chamado a ferramenta e recebido ok.

Resposta
- Português, curta, no estilo de mensagem de WhatsApp. Uma a três linhas na maioria dos casos.
- Confirme o que foi salvo com os dados principais (nome, matéria, data por extenso curta tipo "seg 03/11").
- Sem travessão, sem dois pontos desnecessários, sem markdown pesado. Pode usar *negrito* do WhatsApp e listas com "•" quando listar agenda.
- Nada de entusiasmo artificial.`;
}

async function execTool(name, input) {
  const out = await runTool(name, input);
  console.log(`[tool] ${name}`, JSON.stringify(input), '→', JSON.stringify(out).slice(0, 300));
  return out;
}

// ---------------- Claude ----------------
let anthropic;
export function setClient(c) { anthropic = c; }

async function runClaude(system, turns, text, media = [], semTools = false) {
  anthropic ||= new Anthropic({ apiKey: config.anthropicKey });
  const userContent = media.length
    ? [...media.map((m) => ({ type: 'image', source: { type: 'base64', media_type: m.mimeType, data: m.data } })), { type: 'text', text }]
    : text;
  const messages = [...turns.map((t) => ({ role: t.role, content: t.text })), { role: 'user', content: userContent }];

  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await anthropic.messages.create({
      model: config.model, max_tokens: 1500, system, ...(semTools ? {} : { tools: toolDefs }), messages,
    });
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason !== 'tool_use') {
      return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    }
    const results = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue;
      const out = await execTool(b.name, b.input);
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return null;
}

// ---------------- Gemini ----------------
let geminiFetch = (...a) => fetch(...a);
export function setGeminiFetch(fn) { geminiFetch = fn; }

// Converte o JSON Schema das ferramentas para o formato do Gemini (tipos em maiúsculo).
function toGeminiSchema(s) {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out.type = String(v).toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === 'items') out.items = toGeminiSchema(v);
    else out[k] = v;
  }
  return out;
}

const geminiTools = [{
  functionDeclarations: toolDefs.map((t) => {
    const hasParams = Object.keys(t.input_schema.properties || {}).length > 0;
    return { name: t.name, description: t.description, ...(hasParams ? { parameters: toGeminiSchema(t.input_schema) } : {}) };
  }),
}];

const TRANSIENT = new Set([500, 502, 503, 504]);
const LABEL = {
  criar_avaliacao: 'a avaliação', lancar_nota_avaliacao: 'a nota', criar_tarefa: 'a tarefa', criar_evento: 'o evento',
  concluir_tarefa: 'a conclusão da tarefa', criar_nota: 'a anotação', marcar_habitos: 'os hábitos',
  registrar_leitura: 'a leitura', registrar_treino: 'o treino', registrar_peso: 'o peso',
  lancamento_financeiro: 'o lançamento', consultar_agenda: 'a consulta', ver_status: 'a consulta',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let geminiSleep = sleep;
export function setGeminiSleep(fn) { geminiSleep = fn; }

// Uma chamada ao Gemini com tempo limite. Devolve { status, data } ou { status: 'timeout' }.
async function geminiOnce(model, body, timeoutMs = TIMEOUT_MS) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await geminiFetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[ia] ${model} ${res.status} em ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { status: res.status, data };
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log(`[ia] ${model} sem resposta em ${timeoutMs / 1000}s`);
      return { status: 'timeout', data: {} };
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Tenta o mesmo modelo algumas vezes quando o erro é temporário (503, timeout).
async function geminiWithRetry(model, body, tries, timeoutMs) {
  let last;
  for (let t = 0; t < tries; t++) {
    last = await geminiOnce(model, body, timeoutMs);
    if (last.status === 200) return last;
    if (!(TRANSIENT.has(last.status) || last.status === 'timeout')) return last;
    if (t < tries - 1) await geminiSleep(1500 * 2 ** t);
  }
  return last;
}

async function runGemini(system, turns, text, media = [], semTools = false) {
  const contents = [
    ...turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text }, ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } }))] },
  ];
  const models = [config.geminiModel, ...config.geminiFallbacks.filter((m) => m !== config.geminiModel)];
  let mi = 0;
  const done = []; // ferramentas já executadas nesta mensagem

  for (let i = 0; i < MAX_STEPS; i++) {
    const body = { systemInstruction: { parts: [{ text: system }] }, ...(semTools ? {} : { tools: geminiTools }), contents };
    let r;
    for (;;) {
      // Antes de executar qualquer ferramenta dá para trocar de modelo sem risco de registrar duas vezes.
      const canSwitch = done.length === 0 && mi < models.length - 1;
      r = await geminiWithRetry(models[mi], body, canSwitch ? 2 : 4);
      if (r.status === 200) break;
      const switchable = TRANSIENT.has(r.status) || [404, 429, 'timeout'].includes(r.status);
      if (canSwitch && switchable) {
        console.log(`[ia] trocando para ${models[mi + 1]}`);
        mi++;
        continue;
      }
      break;
    }

    if (r.status !== 200) {
      console.error('[ia] erro', JSON.stringify(r.data).slice(0, 500));
      if (done.length) {
        return `Registrei ${done.join(', ')}, mas o Gemini caiu antes de eu montar a resposta. Confere no Notion.`;
      }
      if (r.status === 429) throw new Error('Limite gratuito do Gemini atingido. Tenta de novo em alguns minutos.');
      if (r.status === 'timeout' || TRANSIENT.has(r.status)) throw new Error('O Gemini está sobrecarregado agora. Tenta de novo em um minuto.');
      throw new Error(`Gemini ${r.status}: ${r.data.error?.message || 'erro'}`);
    }

    const cand = r.data.candidates?.[0];
    const content = cand?.content;
    if (!content?.parts?.length) {
      console.error('[ia] resposta vazia', cand?.finishReason, JSON.stringify(r.data.promptFeedback || {}));
      return done.length ? `Registrei ${done.join(', ')}.` : null;
    }
    contents.push(content); // devolve inteiro para manter as assinaturas de raciocínio

    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      return content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    }
    const responses = [];
    for (const { functionCall } of calls) {
      const out = await execTool(functionCall.name, functionCall.args || {});
      if (out?.ok) done.push(LABEL[functionCall.name] || functionCall.name);
      responses.push({ functionResponse: { name: functionCall.name, response: out } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return null;
}

// ---------------- áudio ----------------
// Transcreve só com o Gemini (sem ferramentas), tentando os modelos reserva. Guarda o texto em auth/transcricoes.jsonl.
export async function transcribe(chatId, audio) {
  const falha = new Error('Não consegui entender o áudio. Manda de novo ou escreve em texto.');
  if (!config.geminiKey) {
    console.error('[áudio] sem GEMINI_API_KEY para transcrever');
    throw falha;
  }
  const body = { contents: [{ role: 'user', parts: [
    { text: 'Transcreva este áudio em português, palavra por palavra. Responda só com a transcrição, sem comentários. Se não houver fala, responda vazio.' },
    { inlineData: { mimeType: audio.mimeType, data: audio.data } },
  ] }] };
  const models = [config.geminiModel, ...config.geminiFallbacks.filter((m) => m !== config.geminiModel)];
  for (const model of models) {
    let r;
    try { r = await geminiWithRetry(model, body, 2, AUDIO_TIMEOUT_MS); } catch (e) { console.error('[áudio]', e.message); continue; }
    if (r.status !== 200) continue;
    const texto = (r.data.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!texto) break; // respondeu, mas sem fala
    try {
      const { date, time } = nowParts();
      fs.mkdirSync(config.authDir, { recursive: true });
      fs.appendFileSync(path.join(config.authDir, 'transcricoes.jsonl'), JSON.stringify({ data: `${date} ${time}`, chat: chatId, texto }) + '\n');
    } catch (e) { console.error('[áudio] não salvou a transcrição', e.message); }
    return texto;
  }
  throw falha;
}

// ---------------- entrada ----------------
// Texto que a IA recebe, com o contexto de mídia e encaminhada. O histórico guarda só isso, sem o binário.
export function composeText(text, { media = [], forwarded = false, transcript, instrucao } = {}) {
  const parts = [];
  if (instrucao) parts.push(`[Instrução do sistema] ${instrucao}`);
  if (forwarded) parts.push('[Mensagem encaminhada por mim, escrita por outra pessoa]');
  if (transcript) parts.push(`[áudio transcrito] ${transcript}`);
  const kinds = new Set(media.map((m) => m.kind));
  if (kinds.has('image')) parts.push(text ? '[Imagem em anexo, com a legenda abaixo]' : '[Imagem em anexo, sem legenda. Veja o que é e registre o que fizer sentido.]');
  if (text) parts.push(text);
  return parts.join('\n');
}

// O áudio nunca vai para o agente: vira texto antes. Se o agente falhar, a transcrição não se perde.
// semTools: só redige texto (sem ferramentas, sem histórico) e devolve null se a IA não responder.
export async function handleText(chatId, text, { media = [], forwarded = false, transcript, semTools = false, instrucao } = {}) {
  const audio = media.find((m) => m.kind === 'audio');
  const visual = media.filter((m) => m.kind !== 'audio');
  if (audio && transcript === undefined) transcript = await transcribe(chatId, audio);
  const turns = history.get(chatId) || [];
  const input = composeText(text, { media: visual, forwarded, transcript, instrucao });
  let reply;
  try {
    const system = await systemPrompt();
    const run = config.provider === 'gemini' ? runGemini : runClaude;
    reply = await run(system, turns, input, visual, semTools);
  } catch (e) {
    if (!transcript) throw e;
    console.error('[agente] falhou com áudio transcrito:', e.message);
    return `Não consegui processar agora, mas guardei o que você disse: "${transcript}"`;
  }
  if (semTools) return reply || null;
  reply ||= 'Me perdi nessa. Pode mandar de novo de outro jeito?';
  history.set(chatId, [...turns, { role: 'user', text: input }, { role: 'assistant', text: reply }].slice(-MAX_TURNS));
  return reply;
}

export function resetHistory(chatId) { history.delete(chatId); }
