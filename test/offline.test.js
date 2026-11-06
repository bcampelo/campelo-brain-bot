// Testes sem rede: Notion e Claude simulados.
process.env.NOTION_TOKEN = 'test';
process.env.ANTHROPIC_API_KEY = 'test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Estado em arquivo (auth/) vai para uma pasta temporária, nunca para o auth/ real.
const tmpAuth = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbot-'));
process.env.AUTH_DIR = tmpAuth;

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { setFetch, DS, PERFIL_ID } = await import('../src/notion.js');
const { runTool, resolve, catalog } = await import('../src/tools.js');
const { diaryTitle, calendarHint, addDays, today } = await import('../src/dates.js');
const FUT = addDays(today(), 5); // data futura relativa: as travas rejeitam datas no passado
const { authorize, textOf } = await import('../src/whatsapp.js');
const { handleText, setClient } = await import('../src/agent.js');

// ---------- Notion falso ----------
const calls = [];
const page = (id, title, titleProp, extra = {}) => ({
  id, url: `https://notion.so/${id}`,
  properties: { [titleProp]: { type: 'title', title: [{ plain_text: title }] }, ...extra },
});
const materias = [
  page('m-est', 'Estatística Computacional', 'Matéria'),
  page('m-so', 'Sistemas Operacionais', 'Matéria'),
  page('m-ed', 'Estrutura de Dados', 'Matéria'),
  page('m-lp', 'Linguagem de Programação II', 'Matéria'),
  page('m-sad', 'Sistemas de Apoio à Decisão', 'Matéria'),
];
const projetos = [page('p-cli', 'Projeto Cliente', 'Projeto')];
const livros = [page('l-1', 'Hábitos Atômicos', 'Livro', { Status: { type: 'status', status: { name: 'Lendo' } } })];
const diario = page('d-1', 'Sáb, 31/10', 'Dia', {
  'Páginas lidas': { type: 'number', number: 10 },
  'Acordei antes das 6:30': { type: 'checkbox', checkbox: false },
  'Atividade física': { type: 'checkbox', checkbox: false },
  'Criação de conteúdo': { type: 'checkbox', checkbox: false },
  'Projeto pessoal': { type: 'checkbox', checkbox: false },
});

const extraRoutes = []; // rotas extras por teste: (url, opts, body) => resposta | undefined
setFetch(async (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url, method: opts.method, body });
  const json = (d) => ({ ok: true, status: 200, json: async () => d });
  for (const r of extraRoutes) { const out = r(url, opts, body); if (out) return out; }
  if (opts.method === 'GET' && url.endsWith(`/data_sources/${DS.materias}`)) {
    return json({ properties: {
      'Matéria': { type: 'title', title: {} },
      Dias: { type: 'multi_select', multi_select: { options: [{ name: 'Seg' }, { name: 'Qua' }] } },
      Status: { type: 'select', select: { options: [{ name: 'Cursando' }] } },
      'Instituição': { type: 'select', select: { options: [{ name: 'UFX' }] } },
      Avaliações: { type: 'relation', relation: { data_source_id: DS.avaliacoes } },
      'Média': { type: 'rollup', rollup: {} },
    } });
  }
  if (opts.method === 'GET' && /\/data_sources\/[^/]+$/.test(url)) return json({ properties: {} });
  if (url.includes('/pages/') && opts.method === 'PATCH' && body.in_trash) return json({ id: 'x' });
  if (url.includes(`/data_sources/${DS.materias}/query`)) return json({ results: materias, has_more: false });
  if (url.includes(`/data_sources/${DS.projetos}/query`)) return json({ results: projetos, has_more: false });
  if (url.includes(`/data_sources/${DS.livros}/query`)) return json({ results: livros, has_more: false });
  if (url.includes(`/data_sources/${DS.diario}/query`)) return json({ results: [diario], has_more: false });
  if (url.includes(`/data_sources/${DS.avaliacoes}/query`)) return json({ results: [], has_more: false });
  if (url.includes(`/data_sources/${DS.notas}/query`)) return json({ results: [page('n-vazia', 'Aula 3', 'Nota'), page('n-cheia', 'Aula 2', 'Nota')], has_more: false });
  if (url.includes('/blocks/n-vazia/children') && opts.method === 'GET') return json({ results: [] });
  if (url.includes('/blocks/n-cheia/children') && opts.method === 'GET') return json({ results: [{ type: 'paragraph' }] });
  if (url.includes('/blocks/') && opts.method === 'PATCH') return json({ results: [] });
  if (url.includes(`/data_sources/${DS.tarefas}/query`)) return json({ results: [page('t-1', 'Entregar relatório Cliente', 'Tarefa')], has_more: false });
  if (url.endsWith('/pages') && opts.method === 'POST') return json({ id: 'new', url: 'https://notion.so/new', properties: body.properties });
  if (url.includes('/pages/') && opts.method === 'PATCH') {
    const props = { ...diario.properties };
    for (const [k, v] of Object.entries(body.properties)) {
      if ('checkbox' in v) props[k] = { type: 'checkbox', checkbox: v.checkbox };
      if ('number' in v) props[k] = { type: 'number', number: v.number };
    }
    return json({ id: 'd-1', properties: props });
  }
  return { ok: false, status: 404, json: async () => ({ message: `rota não simulada ${url}` }) };
});

test('datas', () => {
  assert.equal(diaryTitle('2026-10-31'), 'Sáb, 31/10');
  assert.equal(diaryTitle('2026-12-31'), 'Qui, 31/12');
  assert.equal(addDays('2026-10-31', 2), '2026-11-02');
  assert.match(calendarHint('2026-10-31', 3), /2026-11-02 segunda/);
});

test('resolve matérias por nome, sigla e apelido', async () => {
  const { materias: ms } = await catalog(true);
  const alias = { estatistica: 'Estatística Computacional', so: 'Sistemas Operacionais' };
  assert.equal(resolve(ms, 'estatística', alias).name, 'Estatística Computacional');
  assert.equal(resolve(ms, 'Estatistica computacional').name, 'Estatística Computacional');
  assert.equal(resolve(ms, 'SO', alias).name, 'Sistemas Operacionais');
  assert.equal(resolve(ms, 'ed').name, 'Estrutura de Dados');
  assert.equal(resolve(ms, 'SAD').name, 'Sistemas de Apoio à Decisão');
  assert.equal(resolve(ms, 'química'), null);
});

test('criar_avaliacao monta propriedades certas', async () => {
  calls.length = 0;
  const r = await runTool('criar_avaliacao', { titulo: 'Prova de Estatística', materia: 'estatistica', tipo: 'Prova', data: FUT });
  assert.equal(r.ok, true);
  const post = calls.find((c) => c.url.endsWith('/pages'));
  assert.equal(post.body.parent.data_source_id, DS.avaliacoes);
  assert.deepEqual(post.body.properties['Matéria'], { relation: [{ id: 'm-est' }] });
  assert.deepEqual(post.body.properties.Perfil, { relation: [{ id: PERFIL_ID }] });
  assert.equal(post.body.properties.Data.date.start, FUT);
  assert.equal(post.body.properties.Status.status.name, 'Pendente');
});

test('matéria inexistente devolve erro com opções', async () => {
  const r = await runTool('criar_avaliacao', { titulo: 'x', materia: 'Química', tipo: 'Prova' });
  assert.match(r.error, /Opções/);
});

test('leitura soma páginas no diário', async () => {
  const r = await runTool('registrar_leitura', { paginas: 15 });
  assert.equal(r.paginas_hoje, 25);
  assert.equal(r.livro, 'Hábitos Atômicos');
});

test('treino marca atividade física', async () => {
  const r = await runTool('registrar_treino', { treino: 'Treino B' });
  assert.ok(r.feitos.includes('Atividade física'));
});

test('concluir tarefa por trecho do título', async () => {
  const r = await runTool('concluir_tarefa', { busca: 'relatorio cliente' });
  assert.equal(r.ok, true); // sem acento também precisa achar
  assert.equal(r.tarefa, 'Entregar relatório Cliente');
});

test('nota cria blocos de conteúdo', async () => {
  calls.length = 0;
  await runTool('criar_nota', { titulo: 'AVL', conteudo: 'Rotação simples\n- LL\n- RR', tipo: 'Aula', materia: 'ED' });
  const post = calls.find((c) => c.url.endsWith('/pages'));
  const kids = post.body.children;
  assert.equal(kids[0].type, 'heading_3');
  assert.equal(kids[0].heading_3.rich_text[0].text.content, '📌 Tópicos da aula');
  assert.equal(kids[1].paragraph.rich_text[0].text.content, 'Rotação simples');
  assert.equal(kids[2].type, 'bulleted_list_item');
  assert.ok(kids.some((b) => b.heading_3?.rich_text[0]?.text.content === '🎯 O que cai na prova'));
});

test('autorização', () => {
  const me = { id: '551199990000:12@s.whatsapp.net', lid: '111222@lid' };
  const cfg = (o) => ({ ownerNumbers: ['5511977776666'], allowedChats: ['123@g.us'], allowFromMe: false, ...o });
  const dm = (jid, alt) => ({ key: { remoteJid: jid, remoteJidAlt: alt, fromMe: false } });
  assert.equal(authorize(dm('5511977776666@s.whatsapp.net'), me, cfg()), true);
  assert.equal(authorize(dm('999@lid', '5511977776666@s.whatsapp.net'), me, cfg()), true);
  assert.equal(authorize(dm('5511000000000@s.whatsapp.net'), me, cfg()), false);
  const grp = (participant) => ({ key: { remoteJid: '123@g.us', participant, fromMe: false } });
  assert.equal(authorize(grp('5511977776666@s.whatsapp.net'), me, cfg()), true);
  assert.equal(authorize(grp('5511000000000@s.whatsapp.net'), me, cfg()), false);
  const self = { key: { remoteJid: '551199990000@s.whatsapp.net', fromMe: true } };
  assert.equal(authorize(self, me, cfg()), false);
  assert.equal(authorize(self, me, cfg({ allowFromMe: true })), true);
  const selfLid = { key: { remoteJid: '111222@lid', fromMe: true } };
  assert.equal(authorize(selfLid, me, cfg({ allowFromMe: true })), true);
  const otherFromMe = { key: { remoteJid: '5511000000000@s.whatsapp.net', fromMe: true } };
  assert.equal(authorize(otherFromMe, me, cfg({ allowFromMe: true })), false);
});

test('textOf lê texto, legenda e mensagem temporária', () => {
  assert.equal(textOf({ message: { conversation: ' oi ' } }), 'oi');
  assert.equal(textOf({ message: { extendedTextMessage: { text: 'a' } } }), 'a');
  assert.equal(textOf({ message: { ephemeralMessage: { message: { conversation: 'b' } } } }), 'b');
});

test('agente executa ferramenta e responde', async () => {
  const { config } = await import('../src/config.js');
  config.provider = 'claude';
  config.anthropicKey = 'k';
  let n = 0;
  setClient({
    messages: {
      create: async (req) => {
        n++;
        assert.ok(req.system.includes('Estatística Computacional'));
        if (n === 1) {
          return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'criar_avaliacao', input: { titulo: 'Prova de Estatística', materia: 'Estatística Computacional', tipo: 'Prova', data: FUT } }] };
        }
        const last = req.messages.at(-1).content[0];
        assert.equal(last.type, 'tool_result');
        assert.match(last.content, /"ok":true/);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Prova de Estatística salva pra seg 02/11.' }] };
      },
    },
  });
  const reply = await handleText('chat1', 'nota de estatística: prova segunda');
  assert.equal(reply, 'Prova de Estatística salva pra seg 02/11.');
  assert.equal(n, 2);
});

test('agente com Gemini executa function call e responde', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch } = await import('../src/agent.js');
  config.provider = 'gemini';
  config.geminiKey = 'g';
  let n = 0;
  setGeminiFetch(async (url, opts) => {
    n++;
    const body = JSON.parse(opts.body);
    assert.match(url, /:generateContent$/);
    assert.equal(opts.headers['x-goog-api-key'], 'g');
    const decl = body.tools[0].functionDeclarations;
    assert.equal(decl.find((d) => d.name === 'criar_avaliacao').parameters.type, 'OBJECT');
    assert.equal(decl.find((d) => d.name === 'ver_status').parameters, undefined);
    const ok = (d) => ({ ok: true, status: 200, json: async () => d });
    if (n === 1) {
      return ok({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'registrar_treino', args: { treino: 'Treino B' } }, thoughtSignature: 'sig' }] } }] });
    }
    const last = body.contents.at(-1);
    assert.equal(last.parts[0].functionResponse.name, 'registrar_treino');
    assert.equal(last.parts[0].functionResponse.response.ok, true);
    assert.equal(body.contents.at(-2).parts[0].thoughtSignature, 'sig');
    return ok({ candidates: [{ content: { role: 'model', parts: [{ text: 'Treino B marcado.' }] } }] });
  });
  const reply = await handleText('chat-g', 'treinei B hoje');
  assert.equal(reply, 'Treino B marcado.');
  assert.equal(n, 2);
  config.provider = 'claude';
});

test('número BR com e sem nono dígito e bot no próprio número', async () => {
  const { normNumber } = await import('../src/whatsapp.js');
  assert.equal(normNumber('5511998887777'), normNumber('551198887777'));
  const me = { id: '551198887777:5@s.whatsapp.net' };
  const cfg = { ownerNumbers: ['5511998887777'], allowedChats: [], allowFromMe: false };
  // conversa consigo mesmo vale sem ALLOW_FROM_ME quando o bot está no número do dono
  assert.equal(authorize({ key: { remoteJid: '551198887777@s.whatsapp.net', fromMe: true } }, me, cfg), true);
  // mensagem do dono vindo sem o 9
  assert.equal(authorize({ key: { remoteJid: '551198887777@s.whatsapp.net', fromMe: false } }, { id: '5511999999999@s.whatsapp.net' }, cfg), true);
  // conversa com outra pessoa não dispara o bot
  assert.equal(authorize({ key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: true } }, me, cfg), false);
});

test('Gemini 503 troca de modelo antes de executar ferramenta', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, setGeminiSleep } = await import('../src/agent.js');
  config.provider = 'gemini';
  config.geminiKey = 'g';
  setGeminiSleep(async () => {});
  const seen = [];
  setGeminiFetch(async (url) => {
    const model = url.match(/models\/(.+):generate/)[1];
    seen.push(model);
    if (model === 'gemini-flash-lite-latest') return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok pelo reserva' }] } }] }) };
  });
  const reply = await handleText('chat-503', 'oi');
  assert.equal(reply, 'ok pelo reserva');
  assert.deepEqual(seen, ['gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'gemini-flash-latest']);
  config.provider = 'claude';
});

test('Gemini caindo depois da ferramenta não repete o registro', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, setGeminiSleep } = await import('../src/agent.js');
  config.provider = 'gemini';
  setGeminiSleep(async () => {});
  let n = 0;
  const models = [];
  setGeminiFetch(async (url) => {
    n++;
    models.push(url.match(/models\/(.+):generate/)[1]);
    if (n === 1) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'registrar_peso', args: { kg: 74 } } }] } }] }) };
    return { ok: false, status: 503, json: async () => ({}) };
  });
  const reply = await handleText('chat-503b', 'pesei 74');
  assert.match(reply, /Registrei o peso/);
  assert.ok(models.slice(1).every((m) => m === 'gemini-flash-lite-latest')); // não trocou de modelo
  config.provider = 'claude';
});


test('criar matéria nova pela ferramenta genérica', async () => {
  const { schemaHint } = await import('../src/generic.js');
  const hint = await schemaHint();
  assert.match(hint, /materias, .*Dias \(multi_select: Seg\|Qua\)/);
  assert.doesNotMatch(hint, /Média/); // rollup não aparece como editável
  calls.length = 0;
  const r = await runTool('criar_item', { base: 'materias', campos: '{"Matéria":"Cálculo Diferencial","Dias":["Seg","Qua"],"Status":"Cursando","Instituição":"UFX"}' });
  assert.equal(r.ok, true);
  const post = calls.find((c) => c.url.endsWith('/pages'));
  assert.equal(post.body.parent.data_source_id, DS.materias);
  assert.deepEqual(post.body.properties.Dias, { multi_select: [{ name: 'Seg' }, { name: 'Qua' }] });
  assert.equal(post.body.properties['Matéria'].title[0].text.content, 'Cálculo Diferencial');
});

test('editar e apagar item por título', async () => {
  calls.length = 0;
  const e = await runTool('editar_item', { base: 'materias', item: 'estatistica', campos: '{"Status":"Cursando"}' });
  assert.equal(e.ok, true);
  assert.equal(e.editado, 'Estatística Computacional');
  const a = await runTool('apagar_item', { base: 'materias', item: 'Sistemas Operacionais' });
  assert.equal(a.ok, true);
  assert.ok(calls.some((c) => c.body?.in_trash === true));
});

test('manutenção liga itens sem Perfil e conclui matérias vencidas', async () => {
  const { linkOrphans, concludeFinished } = await import('../src/maintenance.js');
  calls.length = 0;
  const linked = await linkOrphans();
  assert.ok(linked > 0);
  const patch = calls.find((c) => c.method === 'PATCH' && c.body?.properties?.Perfil);
  assert.deepEqual(patch.body.properties.Perfil, { relation: [{ id: PERFIL_ID }] });
  const q = calls.find((c) => c.url.includes('/query') && c.body?.filter?.property === 'Perfil');
  assert.deepEqual(q.body.filter.relation, { is_empty: true });
  calls.length = 0;
  await concludeFinished();
  const mq = calls.find((c) => c.url.includes(`/data_sources/${DS.materias}/query`));
  assert.ok(mq.body.filter.and.some((f) => f.property === 'Término' && f.date.before));
});


test('nota de aula vazia criada à mão ganha o modelo', async () => {
  const { fillEmptyAulas } = await import('../src/maintenance.js');
  calls.length = 0;
  const n = await fillEmptyAulas();
  assert.equal(n, 1);
  const appended = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/blocks/'));
  assert.equal(appended.length, 1);
  assert.match(appended[0].url, /n-vazia/);
});

test('lembretes, fuso e arquivo de calendário', async () => {
  const { withTime } = await import('../src/dates.js');
  const { buildIcs, dueReminders } = await import('../src/lembretes.js');
  assert.equal(withTime('2026-11-02', '15:00'), '2026-11-02T15:00:00-05:00');
  const ics = buildIcs({ titulo: 'Cortar o cabelo', inicio: '2026-11-02T15:00:00-05:00', duracaoMin: 45, alarmeMin: 30 });
  assert.match(ics, /DTSTART:20261102T200000Z/);
  assert.match(ics, /DTEND:20261102T204500Z/);
  assert.match(ics, /SUMMARY:Cortar o cabelo/);
  assert.match(ics, /TRIGGER:-PT30M/);
  const now = new Date('2026-11-02T19:35:00Z'); // 14:35 em UTC-5
  const items = [
    { id: 'a', titulo: 'Cabelo', inicio: '2026-11-02T15:00:00-05:00' },
    { id: 'b', titulo: 'Longe', inicio: '2026-11-02T18:00:00-05:00' },
    { id: 'c', titulo: 'Sem hora', inicio: '2026-11-02' },
  ];
  const due = dueReminders(items, now, 30, {});
  assert.equal(due.length, 1);
  assert.equal(due[0].faltam, 25);
  assert.equal(due[0].hora, '15:00');
  assert.equal(dueReminders(items, now, 30, { [due[0].key]: 1 }).length, 0);
});

test('criar_evento cria tarefa com hora e envia o .ics', async () => {
  const { ctx } = await import('../src/context.js');
  const sent = [];
  const wa = { sendFile: async (...a) => sent.push(a) };
  const before = calls.length;
  const out = await ctx.run({ chat: 'x@s.whatsapp.net', wa }, () => runTool('criar_evento', { titulo: 'Cortar o cabelo', data: FUT, hora: '15:00' }));
  assert.equal(out.ok, true);
  assert.equal(out.arquivo_de_calendario_enviado, true);
  const create = calls.slice(before).find((c) => c.url.endsWith('/pages') && c.method === 'POST');
  assert.equal(create.body.properties.Prazo.date.start, `${FUT}T15:00:00-05:00`);
  assert.equal(sent[0][2], 'evento.ics');
  assert.match(sent[0][1].toString(), /BEGIN:VEVENT/);
  assert.equal((await runTool('criar_evento', { titulo: 'x', data: FUT })).error !== undefined, true);
});

test('foto vai como mídia para o Gemini, encaminhada é sinalizada', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, composeText } = await import('../src/agent.js');
  const { mediaInfo, isForwarded } = await import('../src/whatsapp.js');
  config.provider = 'gemini';
  config.geminiKey = 'g';
  const seen = [];
  setGeminiFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(body.contents.at(-1).parts);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }) };
  });
  await handleText('chat-m2', 'mercado', { media: [{ kind: 'image', mimeType: 'image/jpeg', data: 'SU1H' }], forwarded: true });
  assert.match(seen[0][0].text, /encaminhada/);
  assert.match(seen[0][0].text, /legenda/);
  assert.equal(seen[0][1].inlineData.mimeType, 'image/jpeg');
  assert.match(composeText('oi'), /^oi$/);

  assert.deepEqual(mediaInfo({ message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: '1200' } } }), { kind: 'audio', mimeType: 'audio/ogg', size: 1200 });
  assert.equal(mediaInfo({ message: { conversation: 'oi' } }), null);
  assert.equal(isForwarded({ message: { extendedTextMessage: { text: 'x', contextInfo: { isForwarded: true } } } }), true);
  assert.equal(isForwarded({ message: { conversation: 'x' } }), false);
  config.provider = 'claude';
});

// ---------- 1. transcrição de áudio ----------
const gem = (parts) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }) });
const audio = { kind: 'audio', mimeType: 'audio/ogg', data: 'QUJD' };

test('áudio é transcrito sem ferramentas, salvo em arquivo e o agente recebe só texto', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch } = await import('../src/agent.js');
  config.provider = 'gemini';
  config.geminiKey = 'g';
  const bodies = [];
  setGeminiFetch(async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (!body.tools) return gem([{ text: ' gastei vinte no almoço ' }]);
    return gem([{ text: '🎙️ "gastei vinte no almoço" anotado.' }]);
  });
  const reply = await handleText('chat-a1', '', { media: [audio] });
  assert.match(reply, /anotado/);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].tools, undefined); // transcrição não usa ferramentas
  assert.deepEqual(bodies[0].contents[0].parts[1].inlineData, { mimeType: 'audio/ogg', data: 'QUJD' });
  const agentParts = bodies[1].contents.at(-1).parts;
  assert.equal(agentParts.length, 1); // sem inlineData
  assert.equal(agentParts[0].text, '[áudio transcrito] gastei vinte no almoço');
  const linhas = fs.readFileSync(path.join(tmpAuth, 'transcricoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(linhas.at(-1).texto, 'gastei vinte no almoço');
  assert.equal(linhas.at(-1).chat, 'chat-a1');
  assert.match(linhas.at(-1).data, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  config.provider = 'claude';
});

test('transcrição usa modelo reserva e áudio funciona com provider Claude', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, setGeminiSleep, setClient } = await import('../src/agent.js');
  setGeminiSleep(async () => {});
  config.provider = 'claude';
  config.geminiKey = 'g';
  const models = [];
  setGeminiFetch(async (url) => {
    const model = url.match(/models\/(.+):generate/)[1];
    models.push(model);
    if (model === 'gemini-flash-lite-latest') return { ok: false, status: 503, json: async () => ({}) };
    return gem([{ text: 'oi pelo reserva' }]);
  });
  let visto;
  setClient({ messages: { create: async (req) => { visto = req.messages.at(-1).content; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; } } });
  assert.equal(await handleText('chat-a2', '', { media: [audio] }), 'ok');
  assert.deepEqual(models, ['gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'gemini-flash-latest']);
  assert.equal(visto, '[áudio transcrito] oi pelo reserva'); // Claude recebe texto puro
});

test('agente falha depois da transcrição: devolve o que ele disse', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, setGeminiSleep } = await import('../src/agent.js');
  setGeminiSleep(async () => {});
  config.provider = 'gemini';
  config.geminiKey = 'g';
  setGeminiFetch(async (url, opts) => {
    if (!JSON.parse(opts.body).tools) return gem([{ text: 'lembra de pagar a luz' }]);
    return { ok: false, status: 400, json: async () => ({ error: { message: 'ruim' } }) };
  });
  const reply = await handleText('chat-a3', '', { media: [audio] });
  assert.equal(reply, 'Não consegui processar agora, mas guardei o que você disse: "lembra de pagar a luz"');
  config.provider = 'claude';
});

test('transcrição falhando pede para mandar de novo', async () => {
  const { config } = await import('../src/config.js');
  const { setGeminiFetch, setGeminiSleep } = await import('../src/agent.js');
  setGeminiSleep(async () => {});
  config.provider = 'gemini';
  config.geminiKey = 'g';
  setGeminiFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await assert.rejects(() => handleText('chat-a4', '', { media: [audio] }), /Manda de novo ou escreve/);
  setGeminiFetch(async () => gem([{ text: '  ' }])); // sem fala
  await assert.rejects(() => handleText('chat-a4', '', { media: [audio] }), /Manda de novo ou escreve/);
  config.provider = 'claude';
});

// ---------- 2. /desfazer ----------
test('/desfazer apaga o que foi criado e restaura o que foi editado', async () => {
  const { ctx } = await import('../src/context.js');
  const { tratar } = await import('../src/comandos.js');
  const { paraEscrita } = await import('../src/historico.js');
  const antes = { ...page('t-9', 'Cortar o cabelo', 'Tarefa', {
    Status: { type: 'status', status: { name: 'A fazer' } },
    Prazo: { type: 'date', date: { start: '2026-11-02', end: null, time_zone: null } },
    'Área': { type: 'select', select: null },
  }), parent: { data_source_id: DS.tarefas } };
  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.endsWith('/pages/t-9') ? { ok: true, status: 200, json: async () => antes } : undefined));
  const chat = 'chat-undo';
  calls.length = 0;
  await ctx.run({ chat }, async () => {
    await runTool('criar_tarefa', { titulo: 'Pagar a luz', prazo: FUT });
    const { notion } = await import('../src/notion.js');
    await notion.update('t-9', { Status: { status: { name: 'Feito' } }, 'Área': { select: { name: 'Pessoal' } } });
  });
  const hist = JSON.parse(fs.readFileSync(path.join(tmpAuth, 'historico.json'), 'utf8'))[chat];
  assert.deepEqual(hist.map((h) => h.tipo), ['criou', 'editou']);
  assert.equal(hist[0].base, 'tarefas');
  assert.equal(hist[0].titulo, 'Pagar a luz');
  assert.deepEqual(hist[1].antes.Status, { status: { name: 'A fazer' } });
  assert.deepEqual(hist[1].antes['Área'], { select: null });

  calls.length = 0;
  assert.equal(await tratar({ chat, text: '/desfazer' }), 'Desfeito: edição em tarefa "Cortar o cabelo", valores antigos restaurados.');
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/pages/t-9'));
  assert.deepEqual(patch.body.properties.Status, { status: { name: 'A fazer' } });
  assert.equal(patch.body.properties.Prazo, undefined); // só o que foi alterado volta
  assert.equal(await tratar({ chat, text: '/desfazer' }), 'Desfeito: tarefa "Pagar a luz" apagada.');
  assert.ok(calls.some((c) => c.body?.in_trash === true && c.url.endsWith('/pages/new')));
  assert.equal(await tratar({ chat, text: '/desfazer' }), 'Nada para desfazer.');
  assert.equal(await tratar({ chat, text: 'oi' }), null);
  assert.equal(paraEscrita({ type: 'formula', formula: {} }), null);
  extraRoutes.length = 0;
});

test('/desfazer 3 desfaz várias e escritas fora de uma mensagem não entram no histórico', async () => {
  const { ctx } = await import('../src/context.js');
  const { tratar } = await import('../src/comandos.js');
  const chat = 'chat-undo3';
  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.endsWith('/pages/d-1')
    ? { ok: true, status: 200, json: async () => ({ ...diario, parent: { data_source_id: DS.diario } }) } : undefined));
  await runTool('criar_tarefa', { titulo: 'Fora de ctx' }); // sem ctx: não registra
  await ctx.run({ chat }, async () => {
    for (const t of ['A', 'B', 'C', 'D']) await runTool('criar_tarefa', { titulo: t });
    await runTool('registrar_peso', { kg: 70 }); // diário: editou, e a linha do dia não é registrada como criada
  });
  const out = await tratar({ chat, text: '/desfazer 3' });
  assert.equal(out.split('\n').length, 3);
  assert.match(out, /edição em diário "Sáb, 31\/10"/);
  assert.match(out, /tarefa "D" apagada/);
  assert.match(out, /tarefa "C" apagada/);
  extraRoutes.length = 0;
  const restam = JSON.parse(fs.readFileSync(path.join(tmpAuth, 'historico.json'), 'utf8'))[chat];
  assert.deepEqual(restam.map((h) => h.titulo), ['A', 'B']);
});

// ---------- 3. tarefas recorrentes ----------
test('proximoPrazo: diária, dias úteis, semanal e mensal', async () => {
  const { proximoPrazo } = await import('../src/dates.js');
  assert.equal(proximoPrazo('2026-11-02', 'Diária'), '2026-11-03');
  assert.equal(proximoPrazo('2026-11-02', 'Semanal'), '2026-11-09');
  assert.equal(proximoPrazo('2026-11-06', 'Dias úteis'), '2026-11-09'); // sexta -> segunda
  assert.equal(proximoPrazo('2026-11-07', 'Dias úteis'), '2026-11-09'); // sábado -> segunda
  assert.equal(proximoPrazo('2026-11-04', 'Dias úteis'), '2026-11-05');
  assert.equal(proximoPrazo('2026-01-31', 'Mensal'), '2026-02-28'); // mês menor
  assert.equal(proximoPrazo('2028-01-31', 'Mensal'), '2028-02-29'); // bissexto
  assert.equal(proximoPrazo('2026-12-05', 'Mensal'), '2027-01-05'); // vira o ano
  assert.equal(proximoPrazo('2026-11-02T15:00:00-05:00', 'Semanal'), '2026-11-09T15:00:00-05:00'); // mantém o horário
  assert.equal(proximoPrazo('2026-11-02', 'Anual'), null);
});

const recorrente = (id, extra = {}) => page(id, 'Pagar a academia', 'Tarefa', {
  Status: { type: 'status', status: { name: 'Feito' } },
  Prazo: { type: 'date', date: { start: '2026-11-02T08:00:00-05:00' } },
  Repetir: { type: 'select', select: { name: 'Semanal' } },
  Prioridade: { type: 'select', select: { name: 'Alta' } },
  'Área': { type: 'select', select: { name: 'Pessoal' } },
  'Matéria': { type: 'relation', relation: [{ id: 'm-so' }] },
  Projeto: { type: 'relation', relation: [] },
  ...extra,
});

function rotaTarefas({ abertas = [], todas = [] }) {
  return (url, opts, body) => {
    if (!url.includes(`/data_sources/${DS.tarefas}/query`)) return undefined;
    const lista = body.filter?.and?.[0]?.property === 'Tarefa' ? abertas : todas;
    return { ok: true, status: 200, json: async () => ({ results: lista, has_more: false }) };
  };
}

test('criar_tarefa grava Repetir', async () => {
  calls.length = 0;
  const r = await runTool('criar_tarefa', { titulo: 'Pagar a academia', prazo: FUT, repetir: 'Semanal' });
  assert.equal(r.repetir, 'Semanal');
  const post = calls.find((c) => c.url.endsWith('/pages'));
  assert.deepEqual(post.body.properties.Repetir, { select: { name: 'Semanal' } });
});

test('concluir tarefa recorrente cria a próxima com os mesmos dados', async () => {
  extraRoutes.push(rotaTarefas({ todas: [recorrente('rec-1')] }));
  calls.length = 0;
  const r = await runTool('concluir_tarefa', { busca: 'academia' });
  assert.equal(r.ok, true);
  assert.equal(r.proxima_ocorrencia, 'seg 09/11');
  const post = calls.find((c) => c.url.endsWith('/pages') && c.method === 'POST');
  const p = post.body.properties;
  assert.equal(p.Tarefa.title[0].text.content, 'Pagar a academia');
  assert.equal(p.Prazo.date.start, '2026-11-09T08:00:00-05:00');
  assert.deepEqual(p.Repetir, { select: { name: 'Semanal' } });
  assert.deepEqual(p.Prioridade, { select: { name: 'Alta' } });
  assert.deepEqual(p['Área'], { select: { name: 'Pessoal' } });
  assert.deepEqual(p['Matéria'], { relation: [{ id: 'm-so' }] });
  assert.equal(p.Projeto, undefined);
  assert.equal(p.Status.status.name, 'A fazer');
  // segunda conclusão do mesmo id não duplica
  calls.length = 0;
  await runTool('concluir_tarefa', { busca: 'academia' });
  assert.equal(calls.filter((c) => c.url.endsWith('/pages') && c.method === 'POST').length, 0);
  extraRoutes.length = 0;
});

test('varredura cria a próxima das concluídas no Notion, sem duplicar', async () => {
  const { varrer } = await import('../src/recorrentes.js');
  const feita = recorrente('rec-2');
  const comAberta = recorrente('rec-3', { Prazo: { type: 'date', date: { start: '2026-11-02' } } });
  // rec-3 já tem uma aberta com prazo posterior; rec-2 não
  let consulta = 0;
  extraRoutes.push((url, opts, body) => {
    if (!url.includes(`/data_sources/${DS.tarefas}/query`)) return undefined;
    const f = body.filter.and;
    let results;
    if (f[0].property === 'Tarefa') {
      consulta++;
      results = consulta === 1 ? [] : [page('aberta', 'Pagar a academia', 'Tarefa', { Prazo: { type: 'date', date: { start: '2026-11-09' } } })];
    } else {
      assert.deepEqual(f.map((x) => x.property || x.timestamp), ['Status', 'Repetir', 'last_edited_time']);
      assert.deepEqual(f[1].select, { is_not_empty: true });
      results = [feita, comAberta];
    }
    return { ok: true, status: 200, json: async () => ({ results, has_more: false }) };
  });
  calls.length = 0;
  assert.equal(await varrer(), 1);
  assert.equal(calls.filter((c) => c.url.endsWith('/pages') && c.method === 'POST').length, 1);
  calls.length = 0;
  assert.equal(await varrer(), 0); // ids já processados em recorrentes.json
  assert.equal(calls.filter((c) => c.url.endsWith('/pages') && c.method === 'POST').length, 0);
  const feitos = JSON.parse(fs.readFileSync(path.join(tmpAuth, 'recorrentes.json'), 'utf8'));
  assert.ok(feitos['rec-2'] && feitos['rec-3']);
  extraRoutes.length = 0;
});

// ---------- 4. /diario ----------
test('/diario escreve no corpo da página do dia com o horário e lê o que já foi escrito', async () => {
  const { tratar, textoDiarioDeAudio, diarioPorAudio } = await import('../src/comandos.js');
  calls.length = 0;
  assert.equal(await tratar({ chat: 'c', text: '/diario Hoje a aula de SO foi boa' }), 'Anotado no diário de hoje.');
  const app = calls.find((c) => c.method === 'PATCH' && c.url.includes('/blocks/d-1/children'));
  assert.equal(app.body.children.length, 1);
  assert.match(app.body.children[0].paragraph.rich_text[0].text.content, /^\d{2}:\d{2} Hoje a aula de SO foi boa$/);

  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.includes('/blocks/d-1/children')
    ? { ok: true, status: 200, json: async () => ({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '14:32 Hoje a aula de SO foi boa' }] } }] }) } : undefined));
  assert.equal(await tratar({ chat: 'c', text: '/diario' }), 'Diário de hoje:\n14:32 Hoje a aula de SO foi boa');
  extraRoutes.length = 0;
  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.includes('/blocks/d-1/children') ? { ok: true, status: 200, json: async () => ({ results: [] }) } : undefined));
  assert.equal(await tratar({ chat: 'c', text: '/diario' }), 'Nada escrito no diário hoje.');
  extraRoutes.length = 0;

  assert.equal(textoDiarioDeAudio('Diário, hoje foi puxado'), 'hoje foi puxado');
  assert.equal(textoDiarioDeAudio('diario: acordei cansado'), 'acordei cansado');
  assert.equal(textoDiarioDeAudio('gastei vinte no diário'), null);
  assert.equal(textoDiarioDeAudio('diário'), null);
  calls.length = 0;
  assert.equal(await diarioPorAudio('c', 'diário hoje choveu'), '🎙️ Anotado no diário de hoje.');
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('/blocks/d-1/children')));
  assert.equal(await diarioPorAudio('c', 'gastei 20'), null);
});

test('escrever_diario: ferramenta da IA, com data e sem texto', async () => {
  calls.length = 0;
  const r = await runTool('escrever_diario', { texto: 'Dormi mal', data: '2026-10-31' });
  assert.deepEqual(r, { ok: true, dia: 'Sáb, 31/10' });
  const app = calls.find((c) => c.method === 'PATCH' && c.url.includes('/blocks/d-1/children'));
  assert.equal(app.body.children[0].paragraph.rich_text[0].text.content, 'Dormi mal'); // data passada: sem horário
  assert.match((await runTool('escrever_diario', { texto: '  ' })).error, /texto/);
  const { toolDefs } = await import('../src/tools.js');
  assert.ok(toolDefs.some((t) => t.name === 'escrever_diario'));
});

// ---------- 5. adiar lembrete ----------
test('parseAdiar entende +15, +1h, adiar 30 e amanhã', async () => {
  const { parseAdiar } = await import('../src/lembretes.js');
  assert.deepEqual(parseAdiar('+15'), { minutos: 15 });
  assert.deepEqual(parseAdiar('+1h'), { minutos: 60 });
  assert.deepEqual(parseAdiar('+1,5h'), { minutos: 90 });
  assert.deepEqual(parseAdiar('adiar 30'), { minutos: 30 });
  assert.deepEqual(parseAdiar('Adiar 2 horas'), { minutos: 120 });
  assert.deepEqual(parseAdiar('+20 min'), { minutos: 20 });
  assert.deepEqual(parseAdiar('amanhã'), { amanha: true });
  assert.deepEqual(parseAdiar('adiar para amanha'), { amanha: true });
  for (const t of ['oi', '+0', 'amanhã cedo vou na academia', 'adiar', '15', 'gastei +15']) assert.equal(parseAdiar(t), null, t);
});

test('aviso guarda o id da mensagem; +15 agenda novo aviso; citação e janela de 30 min', async () => {
  const { checkReminders, adiar } = await import('../src/lembretes.js');
  const tarefa = page('t-rem', 'Cortar o cabelo', 'Tarefa', { Prazo: { type: 'date', date: { start: '2026-11-02T15:00:00-05:00' } } });
  extraRoutes.push(rotaTarefas({ todas: [tarefa] }));
  const enviados = [];
  const send = async (t) => { enviados.push(t); return { key: { id: `MSG${enviados.length}` } }; };
  const agora = new Date('2026-11-02T19:35:00Z'); // 14:35 em UTC-5

  assert.equal(await checkReminders(send, agora), 1);
  assert.match(enviados[0], /Cortar o cabelo em 25 min \(15:00\)/);
  const store = JSON.parse(fs.readFileSync(path.join(tmpAuth, 'lembretes.json'), 'utf8'));
  assert.equal(store.__avisos[0].msgId, 'MSG1');
  assert.equal(store.__avisos[0].pageId, 't-rem');
  assert.equal(await checkReminders(send, agora), 0); // não repete o aviso

  // sem citação, logo depois do aviso
  const t0 = Date.now();
  assert.equal(await adiar('+15', null, t0), `Beleza, te aviso de "Cortar o cabelo" às ${nowPartsHM(t0 + 15 * 60000)}.`);
  assert.equal(await checkReminders(send, new Date(t0 + 10 * 60000)), 0);
  assert.equal(await checkReminders(send, new Date(t0 + 16 * 60000)), 1);
  assert.equal(enviados[1], '⏰ Cortar o cabelo (adiado)');
  assert.equal(await checkReminders(send, new Date(t0 + 17 * 60000)), 0); // adiado some depois de enviado

  // citando o aviso certo, mesmo depois de 30 min; citando outra mensagem não vale
  assert.match(await adiar('+1h', 'MSG1', t0 + 3 * 3600e3), /te aviso de "Cortar o cabelo"/);
  assert.equal(await adiar('+1h', 'OUTRA', t0), null);
  // sem citação e fora da janela de 30 min: deixa passar para a IA
  assert.equal(await adiar('amanhã', null, t0 + 3 * 3600e3), null);
  assert.equal(await adiar('bom dia', null, t0), null);
  extraRoutes.length = 0;
});

function nowPartsHM(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}

test('"amanhã" move o Prazo da tarefa para o dia seguinte no mesmo horário', async () => {
  const { checkReminders, adiar } = await import('../src/lembretes.js');
  const tarefa = page('t-rem2', 'Ligar pro cliente', 'Tarefa', { Prazo: { type: 'date', date: { start: '2026-11-02T16:30:00-05:00' } } });
  extraRoutes.push(rotaTarefas({ todas: [tarefa] }));
  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.endsWith('/pages/t-rem2') ? { ok: true, status: 200, json: async () => tarefa } : undefined));
  const send = async () => ({ key: { id: 'MSGX' } });
  await checkReminders(send, new Date('2026-11-02T21:10:00Z')); // 16:10
  calls.length = 0;
  assert.equal(await adiar('amanhã', 'MSGX', Date.now()), 'Ok, "Ligar pro cliente" ficou para amanhã (ter 03/11 16:30).');
  const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/pages/t-rem2'));
  assert.equal(patch.body.properties.Prazo.date.start, '2026-11-03T16:30:00-05:00');
  extraRoutes.length = 0;
});

test('/comandos passa "+15" para o adiar quando há aviso e ignora quando não há', async () => {
  const { tratar } = await import('../src/comandos.js');
  assert.match(await tratar({ chat: 'c', text: '+15', quotedId: 'MSGX' }), /te aviso de "Ligar pro cliente"/);
  assert.equal(await tratar({ chat: 'c', text: '+15', quotedId: 'nao-existe' }), null);
  const { quotedId } = await import('../src/whatsapp.js');
  assert.equal(quotedId({ message: { extendedTextMessage: { text: '+15', contextInfo: { stanzaId: 'ABC' } } } }), 'ABC');
  assert.equal(quotedId({ message: { conversation: '+15' } }), null);
});

// ---------- 6. pesquisar ----------
test('pesquisar usa /search, filtra pelos bancos do Campelo Brain e lê os 3 primeiros com limite de texto', async () => {
  const { notion } = await import('../src/notion.js');
  const doBanco = (id, titulo, ds) => ({ ...page(id, titulo, 'Nota'), parent: { type: 'data_source_id', data_source_id: ds, database_id: 'db' } });
  const achados = [
    { ...page('x-fora', 'Escalonamento no blog', 'title'), parent: { type: 'page_id', page_id: 'qualquer' } }, // fora dos bancos
    doBanco('n-1', 'Escalonamento de processos', DS.notas),
    doBanco('n-2', 'Round robin', DS.notas.replace(/-/g, '')), // mesmo banco, id sem traços
    doBanco('n-3', 'Prova de SO', DS.avaliacoes),
    doBanco('n-4', 'Estudar escalonamento', DS.tarefas),
    doBanco('n-5', 'Escalonamento Linux', DS.notas),
    doBanco('n-6', 'Sexto resultado', DS.notas),
  ];
  const longo = 'a'.repeat(3000);
  const bloco = (t) => ({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: t }] } }] });
  const lidos = [];
  extraRoutes.push((url, opts, body) => {
    if (url.endsWith('/search')) {
      assert.equal(opts.method, 'POST');
      assert.equal(body.query, 'escalonamento');
      return { ok: true, status: 200, json: async () => ({ results: achados }) };
    }
    const m = url.match(/\/blocks\/([^/]+)\/children/);
    if (m && opts.method === 'GET') {
      lidos.push(m[1]);
      return { ok: true, status: 200, json: async () => bloco(m[1] === 'n-1' ? longo : m[1] === 'n-2' ? 'b'.repeat(500) : 'c'.repeat(2000)) };
    }
  });
  const r = await runTool('pesquisar', { termo: 'escalonamento' });
  assert.equal(r.total, 5); // o de fora não conta, máximo 5
  assert.deepEqual(r.resultados.map((x) => x.base), ['notas', 'notas', 'avaliacoes', 'tarefas', 'notas']);
  assert.equal(r.resultados[0].url, 'https://notion.so/n-1');
  assert.deepEqual(lidos, ['n-1', 'n-2', 'n-3']); // só os 3 primeiros
  assert.equal(r.resultados[0].conteudo.length, 3000);
  assert.equal(r.resultados[1].conteudo.length, 500);
  assert.equal(r.resultados[2].conteudo.length, 500); // corta no que resta dos ~4000 caracteres
  assert.equal(r.resultados[3].conteudo, undefined);
  const { toolDefs } = await import('../src/tools.js');
  assert.ok(toolDefs.some((t) => t.name === 'pesquisar'));
  assert.equal(typeof notion.search, 'function');
  extraRoutes.length = 0;
});

test('briefing: sequência, dias restantes, montagem e texto fixo', async () => {
  const { sequencia, diasRestantes, montarBriefing, textoFixo } = await import('../src/briefing.js');
  const dias = {
    '2026-11-05': { A: true }, '2026-11-04': { A: true }, '2026-11-03': { A: true },
    '2026-11-01': { A: true }, // 02 sem linha quebra a sequência
  };
  assert.equal(sequencia(dias, 'A', '2026-11-06'), 3);
  assert.equal(sequencia(dias, 'B', '2026-11-06'), 0);
  assert.equal(sequencia({ '2026-11-04': { A: true } }, 'A', '2026-11-06'), 0); // ontem sem marcar zera
  assert.equal(diasRestantes('2026-11-06', '2026-11-09'), 3);
  assert.equal(diasRestantes('2026-11-06', '2026-11-06T10:00:00-05:00'), 0);

  const b = montarBriefing({
    hoje: '2026-11-06',
    clima: { minima: 22, maxima: 33, chuva: 70 },
    agenda: {
      avaliacoes: [{ avaliacao: 'Prova de SO', materia: 'Sistemas Operacionais', data: '2026-11-09' }, { avaliacao: 'Prova longe', data: '2026-12-20' }],
      tarefas: [{ tarefa: 'Atrasada', prazo: '2026-11-04', atrasada: true }, { tarefa: 'Amanhã', prazo: '2026-11-07' }],
    },
    dias: { '2026-11-05': { 'Atividade física': true, paginas: 0 } },
  });
  assert.equal(b.provas.length, 1);
  assert.equal(b.provas[0].faltam_dias, 3);
  assert.deepEqual(b.tarefas.map((t) => t.tarefa), ['Atrasada']);
  assert.deepEqual(b.notas, ['ontem não teve leitura']);
  const txt = textoFixo(b);
  assert.match(txt, /22° a 33°, 70% de chuva/);
  assert.match(txt, /Prova de SO \(Sistemas Operacionais\), em 3 dias/);
  assert.match(txt, /Atrasada \(atrasada\)/);
  assert.match(txt, /ontem não teve leitura/);
  assert.doesNotMatch(textoFixo({ ...b, clima: null }), /Clima/);
});

test('bomDia: IA redige com os dados; se a IA falha usa texto fixo; clima fora do ar não quebra', async () => {
  const { bomDia, setBriefingFetch, clima } = await import('../src/briefing.js');
  setBriefingFetch(async () => ({ ok: true, json: async () => ({ daily: { temperature_2m_min: [21.6], temperature_2m_max: [34.2], precipitation_probability_max: [40] } }) }));
  assert.deepEqual(await clima(), { minima: 22, maxima: 34, chuva: 40 });

  let instrucao;
  assert.equal(await bomDia(async (i) => { instrucao = i; return 'Bom dia, Fulano.'; }), 'Bom dia, Fulano.');
  assert.match(instrucao, /"clima":\{"minima":22,"maxima":34,"chuva":40\}/);

  const fixo = await bomDia(async () => { throw new Error('Gemini caiu'); });
  assert.match(fixo, /^Bom dia! Resumo de hoje/);
  assert.match(fixo, /Clima: 22° a 34°/);
  assert.match(await bomDia(async () => null), /^Bom dia! Resumo de hoje/);

  setBriefingFetch(async () => { throw new Error('sem rede'); });
  assert.equal(await clima(), null);
  assert.doesNotMatch(await bomDia(async () => null), /Clima/);
});

test('handleText semTools não manda ferramentas nem guarda histórico', async () => {
  const { config } = await import('../src/config.js');
  config.provider = 'claude';
  let req;
  setClient({ messages: { create: async (r) => { req = r; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; } } });
  assert.equal(await handleText('briefing-x', 'redija', { semTools: true }), 'ok');
  assert.equal(req.tools, undefined);
  setClient({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [] }) } });
  assert.equal(await handleText('briefing-x', 'redija', { semTools: true }), null);
});

test('fechamento: janela vale até 03:00 do dia seguinte', async () => {
  const { janelaAberta } = await import('../src/fechamento.js');
  const e = { data: '2026-11-06', chat: 'c', aguardando: true };
  assert.equal(janelaAberta(e, { date: '2026-11-06', time: '21:31' }), true);
  assert.equal(janelaAberta(e, { date: '2026-11-07', time: '02:59' }), true);
  assert.equal(janelaAberta(e, { date: '2026-11-07', time: '03:00' }), false);
  assert.equal(janelaAberta(e, { date: '2026-11-08', time: '01:00' }), false);
  assert.equal(janelaAberta({ ...e, aguardando: false }, { date: '2026-11-06', time: '22:00' }), false);
  assert.equal(janelaAberta(null, { date: '2026-11-06', time: '22:00' }), false);
});

test('fechamento: manda a pergunta uma vez, não manda se o diário tem texto, desliga por config', async () => {
  const { rodarFechamento, fechamentoAberto, concluirFechamento } = await import('../src/fechamento.js');
  const { config } = await import('../src/config.js');
  const { readJson } = await import('../src/store.js');
  fs.rmSync(path.join(tmpAuth, 'fechamento.json'), { force: true });
  const enviados = [];
  const send = async (chat, t) => enviados.push([chat, t]);
  const agora = { date: '2026-11-06', time: '21:30' };
  const diaVazio = (url, opts) => (opts.method === 'GET' && url.includes('/blocks/d-1/children')
    ? { ok: true, status: 200, json: async () => ({ results: [] }) } : undefined);

  extraRoutes.push(diaVazio);
  config.fechamentoHora = '';
  assert.equal(await rodarFechamento(send, 'c', agora), false); // desligado
  config.fechamentoHora = '21:30';
  assert.equal(await rodarFechamento(send, 'c', { date: '2026-11-06', time: '21:29' }), false); // cedo
  assert.equal(await rodarFechamento(send, 'c', agora), true);
  assert.match(enviados[0][1], /^Como foi o dia\? Pode mandar por áudio\.\nAinda sem marcar hoje: .*Atividade física/);
  assert.deepEqual(readJson('fechamento.json'), { data: '2026-11-06', chat: 'c', aguardando: true });
  assert.equal(await rodarFechamento(send, 'c', { date: '2026-11-06', time: '22:00' }), false); // só uma vez por dia
  assert.equal(enviados.length, 1);

  assert.ok(fechamentoAberto('c', { date: '2026-11-06', time: '22:00' }));
  assert.equal(fechamentoAberto('outro', { date: '2026-11-06', time: '22:00' }), null);
  assert.equal(fechamentoAberto('c', { date: '2026-11-07', time: '03:00' }), null);
  concluirFechamento();
  assert.equal(fechamentoAberto('c', { date: '2026-11-06', time: '22:00' }), null);

  extraRoutes.length = 0;
  fs.rmSync(path.join(tmpAuth, 'fechamento.json'), { force: true });
  extraRoutes.push((url, opts) => (opts.method === 'GET' && url.includes('/blocks/d-1/children')
    ? { ok: true, status: 200, json: async () => ({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '09:00 já escrevi' }] } }] }) } : undefined));
  assert.equal(await rodarFechamento(send, 'c', agora), false);
  assert.equal(enviados.length, 1);
  extraRoutes.length = 0;
});

test('fechamento: comando não consome; resposta leva a instrução ao agente', async () => {
  const { fechamentoAberto, instrucaoFechamento } = await import('../src/fechamento.js');
  const { config } = await import('../src/config.js');
  const { writeJson } = await import('../src/store.js');
  const { nowParts } = await import('../src/dates.js');
  const { date } = nowParts();
  writeJson('fechamento.json', { data: date, chat: 'c', aguardando: true });
  const agora = { date, time: '23:00' };
  const { respondeFechamento } = await import('../src/fechamento.js');
  assert.equal(respondeFechamento('c', '/desfazer', agora), false);
  assert.equal(respondeFechamento('c', '/diario oi', agora), false);
  assert.ok(fechamentoAberto('c', agora)); // comando não consumiu
  assert.equal(respondeFechamento('c', 'treinei hoje', agora), true);
  assert.equal(respondeFechamento('c', '', agora), true); // áudio: o texto da legenda vem vazio
  assert.equal(respondeFechamento('outro', 'treinei hoje', agora), false);

  config.provider = 'claude';
  let sistema;
  setClient({ messages: { create: async (r) => { sistema = r.messages.at(-1).content; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Registrei.' }] }; } } });
  assert.equal(await handleText('c', 'treinei e li 10 páginas', { instrucao: instrucaoFechamento }), 'Registrei.');
  assert.match(sistema, /\[Instrução do sistema\] .*escrever_diario/);
  assert.match(sistema, /treinei e li 10 páginas$/);
  fs.rmSync(path.join(tmpAuth, 'fechamento.json'), { force: true });
});

test('travas: data no passado, matéria ambígua e valor ausente não escrevem nada', async () => {
  const escritas = () => calls.filter((c) => c.url.endsWith('/pages') && c.method === 'POST').length;
  const ontem = addDays(today(), -1);
  const antes = addDays(today(), -2);
  calls.length = 0;

  // data: ontem passa, anteontem pede confirmação, confirmado: true libera
  assert.equal((await runTool('criar_tarefa', { titulo: 'x', prazo: ontem })).ok, true);
  const n = escritas();
  for (const [nome, input] of [
    ['criar_tarefa', { titulo: 'x', prazo: antes }],
    ['criar_avaliacao', { titulo: 'x', materia: 'estatistica', data: antes }],
    ['criar_evento', { titulo: 'x', data: antes, hora: '10:00' }],
    ['lancamento_financeiro', { descricao: 'Mercado', valor: 30, data: antes }],
  ]) {
    const r = await runTool(nome, input);
    assert.deepEqual([r.ok, r.duvida], [false, 'data no passado'], nome);
  }
  assert.equal(escritas(), n);
  assert.equal((await runTool('criar_tarefa', { titulo: 'x', prazo: antes, confirmado: true })).ok, true);

  // matéria: "sistemas" bate com SO e SAD
  const amb = await runTool('criar_avaliacao', { titulo: 'x', materia: 'sistemas', data: addDays(today(), 3) });
  assert.deepEqual(amb, { ok: false, duvida: 'matéria ambígua', opcoes: ['Sistemas Operacionais', 'Sistemas de Apoio à Decisão'] });
  assert.equal((await runTool('criar_tarefa', { titulo: 'x', materia: 'sistemas' })).duvida, 'matéria ambígua');
  // nome exato, sigla e apelido não são ambíguos
  for (const materia of ['Sistemas Operacionais', 'SO', 'SAD', 'estatística']) {
    assert.equal((await runTool('criar_avaliacao', { titulo: 'x', materia, data: addDays(today(), 3) })).ok, true, materia);
  }

  // valor
  const antesLanc = escritas();
  for (const valor of [undefined, null, '', 0, 'abc']) {
    assert.deepEqual(await runTool('lancamento_financeiro', { descricao: 'Mercado', valor }), { ok: false, duvida: 'valor ausente' });
  }
  assert.equal(escritas(), antesLanc);
  assert.equal((await runTool('lancamento_financeiro', { descricao: 'Mercado', valor: 12.5 })).ok, true);
});

test('agente: resultado com duvida vira pergunta e a resposta "2" resolve pelo histórico', async () => {
  const { config } = await import('../src/config.js');
  config.provider = 'claude';
  const { handleText, resetHistory } = await import('../src/agent.js');
  resetHistory('duvida');
  calls.length = 0;
  let passo = 0;
  setClient({ messages: { create: async (req) => {
    passo++;
    const ult = req.messages.at(-1);
    if (passo === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'criar_avaliacao', input: { titulo: 'Prova', materia: 'sistemas', tipo: 'Prova', data: addDays(today(), 3) } }] };
    if (passo === 2) {
      assert.match(ult.content[0].content, /"duvida":"matéria ambígua".*Sistemas Operacionais/);
      assert.match(req.system, /duvida/); // regra no prompt
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Qual matéria? 1) Sistemas Operacionais 2) Sistemas de Apoio à Decisão' }] };
    }
    if (passo === 3) {
      assert.equal(ult.content, '2');
      assert.match(req.messages[1].content, /Qual matéria\?/); // pergunta anterior no histórico
      return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b', name: 'criar_avaliacao', input: { titulo: 'Prova', materia: 'Sistemas de Apoio à Decisão', tipo: 'Prova', data: addDays(today(), 3) } }] };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Prova de SAD salva.' }] };
  } } });
  assert.match(await handleText('duvida', 'prova de sistemas semana que vem'), /^Qual matéria\?/);
  assert.equal(calls.filter((c) => c.url.endsWith('/pages')).length, 0); // nada gravado na dúvida
  assert.equal(await handleText('duvida', '2'), 'Prova de SAD salva.');
  const post = calls.find((c) => c.url.endsWith('/pages'));
  assert.deepEqual(post.body.properties['Matéria'], { relation: [{ id: 'm-sad' }] });
});
