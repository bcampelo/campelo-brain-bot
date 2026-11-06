import { DS, PERFIL_ID, notion, P, read, titleOf, queryAll, paragraphs, aulaTemplate, textoDosBlocos } from './notion.js';
import { today, addDays, diaryTitle, humanDate, withTime, nowParts } from './dates.js';
import { ctx } from './context.js';
import { buildIcs } from './lembretes.js';
import { config } from './config.js';
import { genericDefs, runGeneric, isGeneric } from './generic.js';
import { criarProxima } from './recorrentes.js';
import { instalar as instalarHistorico } from './historico.js';

instalarHistorico(); // /desfazer: registra as escritas feitas durante uma mensagem

// ---------- catálogo (matérias, projetos, livros) com cache ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'à', 'e']);
const initials = (name) => norm(name).split(/\s+/).filter((w) => !STOP.has(w)).map((w) => w[0]).join('');

let cache = { at: 0, data: null };
const TTL = 10 * 60 * 1000;

export async function catalog(force = false) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;
  const [materias, projetos, livros] = await Promise.all([
    queryAll(DS.materias, { filter: { property: 'Status', select: { equals: 'Cursando' } } }),
    queryAll(DS.projetos, { filter: { property: 'Status', select: { does_not_equal: 'Concluído' } } }),
    queryAll(DS.livros, { filter: { property: 'Status', status: { does_not_equal: 'Lido' } } }),
  ]);
  const pick = (pages) => pages.map((p) => ({ id: p.id, name: titleOf(p), props: p.properties }));
  cache = {
    at: Date.now(),
    data: {
      materias: pick(materias),
      projetos: pick(projetos),
      livros: pick(livros).map((l) => ({ ...l, status: read(l.props.Status) })),
    },
  };
  return cache.data;
}

export function resolve(items, query, extraAliases = {}) {
  if (!query) return null;
  const q = norm(query);
  const alias = extraAliases[q];
  const byName = (n) => items.find((i) => norm(i.name) === norm(n));
  if (alias && byName(alias)) return byName(alias);
  return (
    items.find((i) => norm(i.name) === q) ||
    items.find((i) => initials(i.name) === q.replace(/\s/g, '')) ||
    items.find((i) => norm(i.name).startsWith(q)) ||
    items.find((i) => norm(i.name).includes(q)) ||
    items.find((i) => q.includes(norm(i.name))) ||
    items.find((i) => norm(i.name).split(/\s+/).some((w) => w.length > 3 && q.includes(w))) ||
    null
  );
}

// Apelidos de matérias vêm do .env (ALIAS_MATERIAS).
const MATERIA_ALIAS = config.materiaAlias;

// Nomes de matérias que o texto poderia ser, quando não há casamento exato (nome, apelido ou sigla). Mais de um = dúvida.
function candidatas(items, query) {
  const q = norm(query);
  if (MATERIA_ALIAS[q] || items.some((i) => norm(i.name) === q || initials(i.name) === q.replace(/\s/g, ''))) return [];
  const nome = (i) => norm(i.name);
  const palavras = (i) => nome(i).split(/\s+/).filter((w) => w.length > 3 && q.includes(w)).length;
  const tiers = [
    items.filter((i) => nome(i).startsWith(q)),
    items.filter((i) => nome(i).includes(q)),
    items.filter((i) => q.includes(nome(i))),
    (() => { const max = Math.max(0, ...items.map(palavras)); return max ? items.filter((i) => palavras(i) === max) : []; })(),
  ];
  return (tiers.find((t) => t.length) || []).map((i) => i.name);
}

async function materiaId(name) {
  if (!name) return { id: null };
  const { materias } = await catalog();
  const m = resolve(materias, name, MATERIA_ALIAS);
  const opcoes = m ? candidatas(materias, name) : [];
  if (opcoes.length > 1) return { ok: false, duvida: 'matéria ambígua', opcoes };
  if (!m) return { error: `Matéria "${name}" não encontrada. Opções: ${materias.map((x) => x.name).join(', ')}` };
  return { id: m.id, name: m.name };
}

async function projetoId(name) {
  if (!name) return { id: null };
  const { projetos } = await catalog();
  const p = resolve(projetos, name);
  if (!p) return { error: `Projeto "${name}" não encontrado. Opções: ${projetos.map((x) => x.name).join(', ')}` };
  return { id: p.id, name: p.name };
}

// ---------- diário ----------
export const HABITOS = {
  acordar: 'Acordei antes das 6:30',
  atividade_fisica: 'Atividade física',
  conteudo: 'Criação de conteúdo',
  projeto_pessoal: 'Projeto pessoal',
};

export async function diaryRow(date = today()) {
  const res = await notion.query(DS.diario, {
    filter: { property: 'Data', date: { equals: date } },
    page_size: 1,
  });
  if (res.results[0]) return res.results[0];
  return notion.create(DS.diario, {
    Dia: P.title(diaryTitle(date)),
    Data: P.date(date),
    Perfil: P.relation(PERFIL_ID),
  });
}

// Texto livre no corpo da página do dia, com o horário na frente (só quando é hoje).
export async function escreverDiario(texto, data) {
  const dia = data || today();
  const row = await diaryRow(dia);
  const hora = dia === today() ? `${nowParts().time} ` : '';
  await notion.append(row.id, paragraphs(`${hora}${texto}`));
  return dia;
}

export async function lerDiario(data = today()) {
  const row = await diaryRow(data);
  return textoDosBlocos(await notion.children(row.id));
}

function habitSummary(page) {
  const pr = page.properties;
  const feitos = Object.values(HABITOS).filter((h) => read(pr[h]));
  const paginas = read(pr['Páginas lidas']) || 0;
  return {
    feitos,
    faltam: Object.values(HABITOS).filter((h) => !read(pr[h])),
    paginas_lidas: paginas,
    treino: read(pr.Treino),
    peso: read(pr['Peso (kg)']),
  };
}

// ---------- travas: na dúvida a ferramenta não escreve, devolve { ok:false, duvida } e a IA pergunta ----------
// `confirmado: true` (só depois de ele responder) pula a trava de data.
function duvidaData(data, confirmado) {
  if (confirmado || !data || !/^\d{4}-\d{2}-\d{2}/.test(data)) return null;
  return data.slice(0, 10) < addDays(today(), -1) ? { ok: false, duvida: 'data no passado', data, hoje: today() } : null;
}

// ---------- implementações ----------
const impl = {
  async criar_avaliacao({ titulo, materia, tipo = 'Prova', data, peso, confirmado }) {
    const d = duvidaData(data, confirmado);
    if (d) return d;
    const m = await materiaId(materia);
    if (m.error || m.duvida) return m;
    const props = {
      'Avaliação': P.title(titulo || `${tipo} de ${m.name}`),
      Tipo: P.select(tipo),
      Status: P.status('Pendente'),
      Perfil: P.relation(PERFIL_ID),
    };
    if (m.id) props['Matéria'] = P.relation(m.id);
    if (data) props.Data = P.date(data);
    if (peso != null) props.Peso = P.number(Number(peso));
    const page = await notion.create(DS.avaliacoes, props);
    return { ok: true, criada: titulo, materia: m.name, data: data && humanDate(data), url: page.url };
  },

  async lancar_nota_avaliacao({ busca, materia, nota }) {
    const m = await materiaId(materia);
    if (m.error || m.duvida) return m;
    const and = [{ property: 'Status', status: { does_not_equal: 'Feita' } }];
    if (m.id) and.push({ property: 'Matéria', relation: { contains: m.id } });
    const pages = await queryAll(DS.avaliacoes, { filter: { and }, sorts: [{ property: 'Data', direction: 'ascending' }] });
    const q = norm(busca);
    const hit = (q ? pages.find((p) => norm(titleOf(p)).includes(q)) : null) || (pages.length === 1 ? pages[0] : null);
    if (!hit) {
      return { error: 'Não achei uma avaliação única.', pendentes: pages.slice(0, 8).map((p) => `${titleOf(p)} (${read(p.properties.Data) || 'sem data'})`) };
    }
    const props = { Status: P.status('Feita') };
    if (nota != null) props.Nota = P.number(Number(nota));
    await notion.update(hit.id, props);
    return { ok: true, avaliacao: titleOf(hit), nota, xp: '+50 XP' };
  },

  async criar_tarefa({ titulo, prazo, hora, prioridade, area, materia, projeto, repetir, confirmado }) {
    const d = duvidaData(prazo, confirmado);
    if (d) return d;
    const [m, pj] = await Promise.all([materiaId(materia), projetoId(projeto)]);
    if (m.error || m.duvida) return m;
    if (pj.error) return pj;
    const props = {
      Tarefa: P.title(titulo),
      Status: P.status('A fazer'),
      Perfil: P.relation(PERFIL_ID),
    };
    const quando = hora ? withTime(prazo || today(), String(hora).padStart(5, '0')) : prazo;
    if (quando) props.Prazo = P.date(quando);
    if (prioridade) props.Prioridade = P.select(prioridade);
    const areaFinal = area || (m.id ? 'Faculdade' : null);
    if (areaFinal) props['Área'] = P.select(areaFinal);
    if (m.id) props['Matéria'] = P.relation(m.id);
    if (pj.id) props.Projeto = P.relation(pj.id);
    if (repetir) props.Repetir = P.select(repetir);
    const page = await notion.create(DS.tarefas, props);
    return { ok: true, tarefa: titulo, prazo: prazo && humanDate(prazo), hora, repetir, aviso: hora && config.reminderMinutes ? `${config.reminderMinutes} min antes` : undefined, materia: m.name, projeto: pj.name, url: page.url };
  },

  async criar_evento({ titulo, data, hora, duracao_min = 60, local, area, repetir, confirmado }) {
    const d = duvidaData(data, confirmado);
    if (d) return d;
    if (!data || !/^\d{1,2}:\d{2}$/.test(hora || '')) return { error: 'Preciso da data e da hora (HH:MM).' };
    const h = hora.padStart(5, '0');
    const inicio = withTime(data, h);
    const props = {
      Tarefa: P.title(titulo),
      Status: P.status('A fazer'),
      Perfil: P.relation(PERFIL_ID),
      Prazo: P.date(inicio),
      'Área': P.select(area || 'Pessoal'),
    };
    if (repetir) props.Repetir = P.select(repetir);
    const page = await notion.create(DS.tarefas, props);
    let calendario = false;
    const c = ctx.getStore();
    if (c?.wa) {
      const ics = buildIcs({ titulo, inicio, duracaoMin: duracao_min, local, alarmeMin: config.reminderMinutes || 30 });
      await c.wa.sendFile(c.chat, Buffer.from(ics, 'utf8'), 'evento.ics', 'text/calendar', `${titulo}, ${humanDate(data)} ${h}. Toque no arquivo para adicionar ao Calendário.`);
      calendario = true;
    }
    return { ok: true, evento: titulo, quando: `${humanDate(data)} ${h}`, arquivo_de_calendario_enviado: calendario, aviso: config.reminderMinutes ? `${config.reminderMinutes} min antes` : undefined, url: page.url };
  },

  async concluir_tarefa({ busca, status = 'Feito' }) {
    const pages = await queryAll(DS.tarefas, { filter: { property: 'Status', status: { does_not_equal: 'Feito' } } });
    const q = norm(busca);
    const hits = pages.filter((p) => norm(titleOf(p)).includes(q));
    const hit = hits.length === 1 ? hits[0] : hits.find((p) => norm(titleOf(p)) === q);
    if (!hit) {
      const lista = (hits.length ? hits : pages).slice(0, 10).map(titleOf);
      return { error: hits.length ? 'Mais de uma tarefa bate com isso.' : 'Nenhuma tarefa aberta bate com isso.', abertas: lista };
    }
    await notion.update(hit.id, { Status: P.status(status) });
    const out = { ok: true, tarefa: titleOf(hit), status };
    if (status === 'Feito' && read(hit.properties.Repetir)) {
      try {
        const prox = await criarProxima(hit);
        if (prox) out.proxima_ocorrencia = humanDate(prox.prazo);
      } catch (e) { out.aviso = `Concluída, mas não criei a próxima ocorrência: ${e.message}`; }
    }
    return out;
  },

  async criar_nota({ titulo, conteudo, tipo = 'Aula', materia, projeto, data }) {
    const [m, pj] = await Promise.all([materiaId(materia), projetoId(projeto)]);
    if (m.error || m.duvida) return m;
    if (pj.error) return pj;
    const props = {
      Nota: P.title(titulo),
      Tipo: P.select(tipo),
      Data: P.date(data || today()),
    };
    if (m.id) props['Matéria'] = P.relation(m.id);
    if (pj.id) props.Projeto = P.relation(pj.id);
    const body = tipo === 'Aula' ? aulaTemplate(conteudo) : paragraphs(conteudo);
    const page = await notion.create(DS.notas, props, body);
    return { ok: true, nota: titulo, materia: m.name, projeto: pj.name, url: page.url };
  },

  async marcar_habitos({ habitos, feito = true, data }) {
    const row = await diaryRow(data || today());
    const props = {};
    for (const h of habitos) {
      const col = HABITOS[h];
      if (col) props[col] = P.checkbox(feito);
    }
    if (!Object.keys(props).length) return { error: `Hábitos válidos: ${Object.keys(HABITOS).join(', ')}` };
    const page = await notion.update(row.id, props);
    return { ok: true, dia: diaryTitle(data || today()), ...habitSummary(page) };
  },

  async registrar_leitura({ paginas, livro, somar = true, data }) {
    const row = await diaryRow(data || today());
    const atual = read(row.properties['Páginas lidas']) || 0;
    const total = somar ? atual + Number(paginas) : Number(paginas);
    const props = { 'Páginas lidas': P.number(total) };
    let livroNome = null;
    const { livros } = await catalog();
    const l = livro ? resolve(livros, livro) : livros.find((x) => x.status === 'Lendo');
    if (livro && !l) return { error: `Livro "${livro}" não encontrado. Lendo agora: ${livros.filter((x) => x.status === 'Lendo').map((x) => x.name).join(', ') || 'nenhum'}` };
    if (l) {
      props.Livro = P.relation(l.id);
      livroNome = l.name;
    }
    const page = await notion.update(row.id, props);
    return { ok: true, paginas_hoje: total, livro: livroNome, ...habitSummary(page) };
  },

  async registrar_treino({ treino = 'Outro', data }) {
    const row = await diaryRow(data || today());
    const page = await notion.update(row.id, {
      Treino: P.select(treino),
      'Atividade física': P.checkbox(true),
    });
    return { ok: true, treino, ...habitSummary(page) };
  },

  async registrar_peso({ kg, data }) {
    const row = await diaryRow(data || today());
    await notion.update(row.id, { 'Peso (kg)': P.number(Number(kg)) });
    return { ok: true, peso: kg };
  },

  async lancamento_financeiro({ descricao, valor, tipo = 'Saída', categoria = 'Outros', data, fixa = false, confirmado }) {
    if (valor == null || valor === '' || !Number(valor)) return { ok: false, duvida: 'valor ausente' };
    const d = duvidaData(data, confirmado);
    if (d) return d;
    await notion.create(DS.lancamentos, {
      'Descrição': P.title(descricao),
      Valor: P.number(Math.abs(Number(valor))),
      Tipo: P.select(tipo),
      Categoria: P.select(categoria),
      Data: P.date(data || today()),
      Fixa: P.checkbox(fixa),
    });
    return { ok: true, descricao, valor, tipo, categoria };
  },

  async escrever_diario({ texto, data }) {
    if (!String(texto || '').trim()) return { error: 'Preciso do texto para o diário.' };
    const dia = await escreverDiario(String(texto).trim(), data);
    return { ok: true, dia: diaryTitle(dia) };
  },

  async consultar_agenda({ dias = 7 }) {
    const hoje = today();
    const ate = addDays(hoje, Number(dias));
    const [tarefas, avaliacoes, row] = await Promise.all([
      queryAll(DS.tarefas, {
        filter: { and: [
          { property: 'Status', status: { does_not_equal: 'Feito' } },
          { property: 'Prazo', date: { on_or_before: ate } },
        ] },
        sorts: [{ property: 'Prazo', direction: 'ascending' }],
      }),
      queryAll(DS.avaliacoes, {
        filter: { and: [
          { property: 'Status', status: { does_not_equal: 'Feita' } },
          { property: 'Data', date: { on_or_after: hoje } },
          { property: 'Data', date: { on_or_before: ate } },
        ] },
        sorts: [{ property: 'Data', direction: 'ascending' }],
      }),
      diaryRow(hoje),
    ]);
    const { materias } = await catalog();
    const nomeMateria = (ids) => ids?.map((id) => materias.find((m) => m.id === id)?.name).filter(Boolean).join(', ') || null;
    return {
      hoje: humanDate(hoje),
      tarefas: tarefas.map((p) => ({
        tarefa: titleOf(p),
        prazo: read(p.properties.Prazo),
        atrasada: read(p.properties.Prazo) < hoje,
        prioridade: read(p.properties.Prioridade),
      })),
      avaliacoes: avaliacoes.map((p) => ({
        avaliacao: titleOf(p),
        tipo: read(p.properties.Tipo),
        materia: nomeMateria(read(p.properties['Matéria'])),
        data: read(p.properties.Data),
      })),
      habitos_hoje: habitSummary(row),
    };
  },

  async ver_status() {
    const page = await notion.page(PERFIL_ID);
    const pr = page.properties;
    const get = (k) => read(pr[k]);
    return {
      nivel: get('Nível'),
      xp_total: get('XP total'),
      saldo_xp: get('Saldo de XP'),
      xp_hoje: get('XP de hoje'),
      proximo_nivel: get('Próximo nível'),
      habitos_hoje: get('Hábitos de hoje'),
      livros_lidos_no_ano: get('Livros lidos no ano'),
    };
  },
};

// ---------- schemas para o Claude ----------
const date = { type: 'string', description: 'Data ISO YYYY-MM-DD. Use o calendário do prompt para converter "segunda", "amanhã" etc.' };

const specificDefs = [
  {
    name: 'criar_avaliacao',
    description: 'Cadastra prova, trabalho, seminário ou lista de uma matéria. Use quando ele avisar que tem prova/trabalho em alguma data.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Ex: "Prova 2 de Estatística". Inclua o conteúdo se ele disser.' },
        materia: { type: 'string', description: 'Nome exato de uma matéria da lista.' },
        tipo: { type: 'string', enum: ['Prova', 'Trabalho', 'Seminário', 'Lista'] },
        data: date,
        peso: { type: 'number' },
        confirmado: { type: 'boolean', description: 'true só depois que ele respondeu a uma pergunta de dúvida (ex: confirmou que a data no passado está certa).' },
      },
      required: ['titulo', 'materia', 'tipo'],
    },
  },
  {
    name: 'lancar_nota_avaliacao',
    description: 'Registra a nota tirada numa avaliação e marca como feita. Também serve para só marcar como feita (sem nota).',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Parte do nome da avaliação, ex: "prova 1". Pode ficar vazio se a matéria só tiver uma pendente.' },
        materia: { type: 'string' },
        nota: { type: 'number' },
      },
    },
  },
  {
    name: 'criar_tarefa',
    description: 'Cria uma tarefa (to-do). Use para qualquer coisa a fazer que não seja prova/trabalho avaliado.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        prazo: date,
        hora: { type: 'string', description: 'HH:MM, só se ele disser um horário. Com hora, o bot avisa antes de começar.' },
        prioridade: { type: 'string', enum: ['Alta', 'Média', 'Baixa'] },
        area: { type: 'string', enum: config.areas },
        materia: { type: 'string' },
        projeto: { type: 'string' },
        repetir: { type: 'string', enum: ['Diária', 'Dias úteis', 'Semanal', 'Mensal'], description: 'Só se for recorrente ("toda segunda", "todo dia 5"). O prazo é a próxima ocorrência.' },
        confirmado: { type: 'boolean', description: 'true só depois que ele respondeu a uma pergunta de dúvida (ex: confirmou que a data no passado está certa).' },
      },
      required: ['titulo'],
    },
  },
  {
    name: 'criar_evento',
    description: 'Compromisso com data e hora (cortar o cabelo às 15h, reunião, consulta). Cria no Notion, manda um arquivo .ics para ele adicionar ao Calendário da Apple e avisa antes do horário.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        data: date,
        hora: { type: 'string', description: 'HH:MM em 24h. "15h" vira "15:00".' },
        duracao_min: { type: 'number', description: 'Padrão 60.' },
        local: { type: 'string' },
        area: { type: 'string', enum: config.areas },
        repetir: { type: 'string', enum: ['Diária', 'Dias úteis', 'Semanal', 'Mensal'], description: 'Só se for recorrente ("toda segunda", "todo dia 5"). O prazo é a próxima ocorrência.' },
        confirmado: { type: 'boolean', description: 'true só depois que ele respondeu a uma pergunta de dúvida (ex: confirmou que a data no passado está certa).' },
      },
      required: ['titulo', 'data', 'hora'],
    },
  },
  {
    name: 'concluir_tarefa',
    description: 'Marca uma tarefa aberta como Feito (ou Fazendo).',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Parte do título da tarefa.' },
        status: { type: 'string', enum: ['Feito', 'Fazendo'] },
      },
      required: ['busca'],
    },
  },
  {
    name: 'criar_nota',
    description: 'Salva uma anotação (aula, resumo, ideia, referência), opcionalmente ligada a matéria ou projeto. Use para "anota que...", conteúdo de aula, ideias soltas.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto.' },
        conteudo: { type: 'string', description: 'Texto da nota, organizado e fiel ao que ele mandou. Use "- " para tópicos.' },
        tipo: { type: 'string', enum: ['Aula', 'Resumo', 'Ideia', 'Referência'] },
        materia: { type: 'string' },
        projeto: { type: 'string' },
        data: date,
      },
      required: ['titulo', 'conteudo', 'tipo'],
    },
  },
  {
    name: 'marcar_habitos',
    description: 'Marca ou desmarca hábitos do dia no Diário. Leitura NÃO é aqui (use registrar_leitura). Treino com tipo use registrar_treino.',
    input_schema: {
      type: 'object',
      properties: {
        habitos: { type: 'array', items: { type: 'string', enum: Object.keys(HABITOS) } },
        feito: { type: 'boolean', description: 'false para desmarcar.' },
        data: date,
      },
      required: ['habitos'],
    },
  },
  {
    name: 'registrar_leitura',
    description: 'Registra páginas lidas no dia (soma com o que já tinha). Vale como hábito de leitura e dá XP.',
    input_schema: {
      type: 'object',
      properties: {
        paginas: { type: 'number' },
        livro: { type: 'string', description: 'Opcional. Sem isso usa o livro com status Lendo.' },
        somar: { type: 'boolean', description: 'false se ele disser o total do dia em vez de um acréscimo.' },
        data: date,
      },
      required: ['paginas'],
    },
  },
  {
    name: 'registrar_treino',
    description: 'Registra treino na academia/cardio e marca atividade física.',
    input_schema: {
      type: 'object',
      properties: {
        treino: { type: 'string', enum: ['Treino A', 'Treino B', 'Treino C', 'Cardio', 'Outro'] },
        data: date,
      },
    },
  },
  {
    name: 'registrar_peso',
    description: 'Registra o peso do dia em kg.',
    input_schema: { type: 'object', properties: { kg: { type: 'number' }, data: date }, required: ['kg'] },
  },
  {
    name: 'lancamento_financeiro',
    description: 'Lança um gasto ou entrada de dinheiro.',
    input_schema: {
      type: 'object',
      properties: {
        descricao: { type: 'string' },
        valor: { type: 'number', description: 'Em reais, positivo.' },
        tipo: { type: 'string', enum: ['Entrada', 'Saída'] },
        categoria: { type: 'string', enum: [config.workArea, 'Freela', 'Outras entradas', 'Alimentação', 'Transporte', 'Assinaturas', 'Faculdade', 'Lazer', 'Saúde', 'Compras', 'Outros'] },
        data: date,
        fixa: { type: 'boolean' },
        confirmado: { type: 'boolean', description: 'true só depois que ele respondeu a uma pergunta de dúvida (ex: confirmou que a data no passado está certa).' },
      },
      required: ['descricao', 'valor', 'tipo', 'categoria'],
    },
  },
  {
    name: 'escrever_diario',
    description: 'Acrescenta texto livre no diário do dia (corpo da página do Diário), com o horário na frente. Use para "anota no diário que...", desabafos e relatos do dia. Não use para hábitos (marcar_habitos) nem para notas de estudo (criar_nota).',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'O que ele quer registrar, fiel ao que disse, na primeira pessoa.' }, data: date },
      required: ['texto'],
    },
  },
  {
    name: 'consultar_agenda',
    description: 'Lista tarefas abertas (inclui atrasadas), provas/trabalhos dos próximos dias e hábitos de hoje.',
    input_schema: { type: 'object', properties: { dias: { type: 'number', description: 'Janela em dias. Padrão 7.' } } },
  },
  {
    name: 'ver_status',
    description: 'Mostra nível, XP total, saldo de XP, XP de hoje e hábitos de hoje.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const toolDefs = [...specificDefs, ...genericDefs];

export async function runTool(name, input) {
  try {
    if (isGeneric(name)) {
      const out = await runGeneric(name, input);
      // Matéria, projeto ou livro novo/editado precisa aparecer na próxima mensagem.
      if (['materias', 'projetos', 'livros'].includes(input?.base) && name !== 'buscar_itens' && name !== 'ler_item') cache.at = 0;
      return out;
    }
    const fn = impl[name];
    if (!fn) return { error: `Ferramenta desconhecida: ${name}` };
    return await fn(input || {});
  } catch (e) {
    return { error: e.message };
  }
}

export { impl as _impl, norm };
