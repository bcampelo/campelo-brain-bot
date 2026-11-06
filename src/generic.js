// Ferramentas genéricas: deixam a IA criar, editar, buscar, ler e apagar
// itens em qualquer database do Campelo Brain, lendo o schema real do Notion.
import { DS, PERFIL_ID, notion, P, read, titleOf, paragraphs, textoDosBlocos } from './notion.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const BASES = {
  materias: 'matérias da faculdade, inglês e cursos',
  avaliacoes: 'provas, trabalhos, seminários e listas',
  tarefas: 'to-dos',
  projetos: 'projetos e iniciativas',
  notas: 'anotações de aula, resumos, ideias',
  diario: 'uma linha por dia com hábitos, leitura, treino e peso',
  livros: 'estante de livros',
  lancamentos: 'finanças, entradas e saídas',
  recompensas: 'loja de recompensas compradas com XP',
  ficha_treino: 'ficha de exercícios da academia',
  areas: 'áreas da vida',
};

const WRITABLE = new Set(['title', 'rich_text', 'number', 'checkbox', 'select', 'multi_select', 'status', 'date', 'relation', 'url', 'email', 'phone_number']);

// ---------- schema ----------
let schemas = null;
let fetchedAt = 0;
const TTL = 30 * 60 * 1000;

export async function loadSchemas(force = false) {
  if (!force && schemas && Date.now() - fetchedAt < TTL) return schemas;
  const out = {};
  await Promise.all(Object.keys(BASES).map(async (key) => {
    try {
      const ds = await notion.dataSource(DS[key]);
      const props = {};
      for (const [name, p] of Object.entries(ds.properties || {})) {
        props[name] = {
          type: p.type,
          options: (p[p.type]?.options || []).map((o) => o.name),
          target: p.type === 'relation' ? p.relation?.data_source_id : undefined,
        };
      }
      out[key] = props;
    } catch (e) {
      console.warn(`[schema] ${key}: ${e.message}`);
    }
  }));
  schemas = out;
  fetchedAt = Date.now();
  return schemas;
}

// Texto curto com os campos de cada base, para o prompt da IA.
export async function schemaHint() {
  const s = await loadSchemas();
  return Object.entries(s).map(([key, props]) => {
    const fields = Object.entries(props)
      .filter(([, p]) => WRITABLE.has(p.type) && !(p.type === 'relation' && p.target === DS.perfil))
      .map(([name, p]) => {
        if (p.options.length) return `${name} (${p.type}: ${p.options.join('|')})`;
        if (p.type === 'relation') {
          const base = Object.keys(DS).find((k) => DS[k] === p.target);
          return `${name} (relação com ${base || 'outra base'}, use o nome)`;
        }
        return `${name} (${p.type})`;
      });
    return `• ${key}, ${BASES[key]}. Campos: ${fields.join(', ')}`;
  }).join('\n');
}

// ---------- conversão de valores ----------
async function findByTitle(dsId, text) {
  const res = await notion.query(dsId, { page_size: 100 });
  const q = norm(text);
  return (
    res.results.find((p) => norm(titleOf(p)) === q) ||
    res.results.find((p) => norm(titleOf(p)).includes(q)) ||
    res.results.find((p) => q.includes(norm(titleOf(p))) && norm(titleOf(p)).length > 2) ||
    null
  );
}

const isId = (v) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(v));

function parseCampos(campos) {
  if (!campos) return {};
  if (typeof campos === 'object') return campos;
  try { return JSON.parse(campos); } catch { throw new Error('campos precisa ser um JSON válido'); }
}

async function toProperties(base, rawCampos) {
  const campos = parseCampos(rawCampos);
  const schema = (await loadSchemas())[base];
  if (!schema) throw new Error(`Base "${base}" indisponível`);
  const props = {};
  const ignored = [];
  for (const [rawName, value] of Object.entries(campos || {})) {
    const name = Object.keys(schema).find((n) => norm(n) === norm(rawName));
    const def = name && schema[name];
    if (!def || !WRITABLE.has(def.type)) { ignored.push(rawName); continue; }
    if (value === null || value === '') {
      props[name] = def.type === 'title' ? P.title('') : { [def.type]: def.type === 'multi_select' || def.type === 'relation' || def.type === 'rich_text' ? [] : null };
      continue;
    }
    switch (def.type) {
      case 'title': props[name] = P.title(value); break;
      case 'rich_text': props[name] = P.text(value); break;
      case 'number': props[name] = P.number(Number(String(value).replace(',', '.'))); break;
      case 'checkbox': props[name] = P.checkbox(value === true || /^(true|sim|1)$/i.test(String(value))); break;
      case 'select': props[name] = P.select(String(value)); break;
      case 'status': props[name] = P.status(String(value)); break;
      case 'multi_select': props[name] = { multi_select: [].concat(value).map((v) => ({ name: String(v) })) }; break;
      case 'date':
        props[name] = typeof value === 'object' ? { date: { start: value.start, end: value.end || null } } : P.date(String(value));
        break;
      case 'url': props[name] = { url: String(value) }; break;
      case 'email': props[name] = { email: String(value) }; break;
      case 'phone_number': props[name] = { phone_number: String(value) }; break;
      case 'relation': {
        const ids = [];
        for (const v of [].concat(value)) {
          if (isId(v)) { ids.push(v); continue; }
          const hit = await findByTitle(def.target, v);
          if (!hit) throw new Error(`Não achei "${v}" para o campo ${name}`);
          ids.push(hit.id);
        }
        props[name] = P.relation(ids);
        break;
      }
    }
  }
  return { props, ignored, schema };
}

function simplify(page, schema) {
  const out = { id: page.id, titulo: titleOf(page) };
  for (const [name, prop] of Object.entries(page.properties)) {
    if (prop.type === 'title') continue;
    if (schema?.[name]?.type === 'relation' && schema[name].target === DS.perfil) continue;
    const v = read(prop);
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[name] = v;
  }
  return out;
}

async function resolveItem(base, item) {
  if (isId(item)) return notion.page(item);
  const hit = await findByTitle(DS[base], item);
  if (!hit) throw new Error(`Não achei "${item}" em ${base}`);
  return hit;
}

// ---------- ferramentas ----------
const impl = {
  async buscar_itens({ base, texto, limite = 15 }) {
    const schema = (await loadSchemas())[base];
    const res = await notion.query(DS[base], { page_size: 100 });
    const q = norm(texto);
    const pages = res.results.filter((p) => !q || norm(JSON.stringify(simplify(p, schema))).includes(q));
    return { base, total: pages.length, itens: pages.slice(0, limite).map((p) => simplify(p, schema)) };
  },

  async ler_item({ base, item }) {
    const page = await resolveItem(base, item);
    const schema = (await loadSchemas())[base];
    const blocks = await notion.children(page.id).catch(() => ({ results: [] }));
    const texto = textoDosBlocos(blocks);
    return { ...simplify(page, schema), conteudo: texto || null };
  },

  // Busca por título no workspace inteiro, fica só com o que é de um banco do Campelo Brain e lê os primeiros.
  async pesquisar({ termo }) {
    const res = await notion.search(termo);
    const baseDe = (p) => Object.keys(DS).find((k) => DS[k].replace(/-/g, '') === String(p.parent?.data_source_id || '').replace(/-/g, ''));
    const achados = res.results.filter(baseDe).slice(0, 5);
    let resta = 4000; // limite de texto somado dos 3 primeiros
    const resultados = [];
    for (const [i, p] of achados.entries()) {
      const r = { base: baseDe(p), titulo: titleOf(p), url: p.url };
      if (i < 3 && resta > 0) {
        const blocks = await notion.children(p.id).catch(() => ({ results: [] }));
        r.conteudo = textoDosBlocos(blocks, resta) || null;
        resta -= r.conteudo?.length || 0;
      }
      resultados.push(r);
    }
    return { termo, total: resultados.length, resultados };
  },

  async criar_item({ base, campos, conteudo }) {
    const { props, ignored, schema } = await toProperties(base, campos);
    const perfil = Object.entries(schema).find(([, p]) => p.type === 'relation' && p.target === DS.perfil);
    if (perfil) props[perfil[0]] = P.relation(PERFIL_ID);
    const page = await notion.create(DS[base], props, paragraphs(conteudo));
    return { ok: true, criado: titleOf(page), base, ignorados: ignored.length ? ignored : undefined, url: page.url };
  },

  async editar_item({ base, item, campos, adicionar_conteudo }) {
    const page = await resolveItem(base, item);
    const { props, ignored } = await toProperties(base, campos || {});
    if (Object.keys(props).length) await notion.update(page.id, props);
    if (adicionar_conteudo) await notion.append(page.id, paragraphs(adicionar_conteudo));
    return { ok: true, editado: titleOf(page), campos: Object.keys(props), ignorados: ignored.length ? ignored : undefined };
  },

  async apagar_item({ base, item }) {
    const page = await resolveItem(base, item);
    await notion.trash(page.id);
    return { ok: true, apagado: titleOf(page), obs: 'Foi para a lixeira do Notion, dá para restaurar por 30 dias.' };
  },
};

const baseEnum = { type: 'string', enum: Object.keys(BASES) };

export const genericDefs = [
  {
    name: 'buscar_itens',
    description: 'Lista ou procura itens de uma base. Use para responder perguntas, achar algo antes de editar ou conferir o que existe.',
    input_schema: { type: 'object', properties: { base: baseEnum, texto: { type: 'string', description: 'Filtro por texto. Vazio lista tudo.' }, limite: { type: 'number' } }, required: ['base'] },
  },
  {
    name: 'pesquisar',
    description: 'Pesquisa pelo título em todo o Campelo Brain (notas, tarefas, avaliações etc.) e já traz o texto das primeiras páginas achadas. Use para "o que anotei sobre X?". Para anotações de uma matéria, combine buscar_itens (base notas, texto = matéria) com ler_item.',
    input_schema: { type: 'object', properties: { termo: { type: 'string', description: 'Palavra ou trecho do título.' } }, required: ['termo'] },
  },
  {
    name: 'ler_item',
    description: 'Lê um item inteiro, incluindo o texto da página (ex: conteúdo de uma anotação).',
    input_schema: { type: 'object', properties: { base: baseEnum, item: { type: 'string', description: 'Título ou id do item.' } }, required: ['base', 'item'] },
  },
  {
    name: 'criar_item',
    description: 'Cria item em qualquer base usando os nomes de campo do schema. Use quando nenhuma ferramenta específica servir (ex: matéria nova, projeto novo, livro, recompensa, exercício).',
    input_schema: {
      type: 'object',
      properties: {
        base: baseEnum,
        campos: { type: 'string', description: 'JSON com campo → valor, ex: {"Matéria":"Cálculo Diferencial","Dias":["Seg","Qua"],"Status":"Cursando"}. Datas em ISO. multi_select e relação aceitam lista. Relação aceita nomes.' },
        conteudo: { type: 'string', description: 'Texto opcional para o corpo da página.' },
      },
      required: ['base', 'campos'],
    },
  },
  {
    name: 'editar_item',
    description: 'Muda campos de um item existente (data, título, status, nota, prioridade, matéria etc.) e/ou acrescenta texto no corpo.',
    input_schema: {
      type: 'object',
      properties: {
        base: baseEnum,
        item: { type: 'string', description: 'Título atual ou id.' },
        campos: { type: 'string', description: 'JSON só com os campos que mudam, ex: {"Data":"2026-11-10"}.' },
        adicionar_conteudo: { type: 'string' },
      },
      required: ['base', 'item'],
    },
  },
  {
    name: 'apagar_item',
    description: 'Manda um item para a lixeira do Notion. Só use quando ele pedir para apagar/remover/cancelar.',
    input_schema: { type: 'object', properties: { base: baseEnum, item: { type: 'string' } }, required: ['base', 'item'] },
  },
];

export async function runGeneric(name, input) {
  return impl[name](input || {});
}
export const isGeneric = (name) => name in impl;
