import { config } from './config.js';

// IDs das data sources do Campelo Brain, lidos do .env (NOTION_DS_*).
export const DS = config.notionIds;

// Página da pessoa no Perfil. Tudo que soma XP precisa estar ligado nela.
export const PERFIL_ID = config.notionPerfilId;

const API = 'https://api.notion.com/v1';
const VERSION = '2025-09-03';

// Injetável para testes.
let fetchImpl = (...a) => fetch(...a);
export function setFetch(fn) { fetchImpl = fn; }

async function call(method, path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.notionToken}`,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || JSON.stringify(data)}`);
    return data;
  }
  throw new Error('Notion indisponível depois de 3 tentativas');
}

export const notion = {
  query: (dsId, body = {}) => call('POST', `/data_sources/${dsId}/query`, body),
  create: (dsId, properties, children) =>
    call('POST', '/pages', {
      parent: { type: 'data_source_id', data_source_id: dsId },
      properties,
      ...(children?.length ? { children } : {}),
    }),
  update: (pageId, properties) => call('PATCH', `/pages/${pageId}`, { properties }),
  page: (pageId) => call('GET', `/pages/${pageId}`),
  dataSource: (dsId) => call('GET', `/data_sources/${dsId}`),
  trash: (pageId) => call('PATCH', `/pages/${pageId}`, { in_trash: true }),
  children: (blockId) => call('GET', `/blocks/${blockId}/children?page_size=100`),
  search: (query, pageSize = 25) => call('POST', '/search', { query, page_size: pageSize, filter: { property: 'object', value: 'page' } }),
  append: (blockId, children) => call('PATCH', `/blocks/${blockId}/children`, { children }),
};

// ---------- construtores de propriedade ----------
export const P = {
  title: (t) => ({ title: [{ text: { content: String(t).slice(0, 2000) } }] }),
  text: (t) => ({ rich_text: [{ text: { content: String(t).slice(0, 2000) } }] }),
  date: (iso) => ({ date: { start: iso } }),
  select: (name) => ({ select: { name } }),
  status: (name) => ({ status: { name } }),
  number: (n) => ({ number: n }),
  checkbox: (b) => ({ checkbox: !!b }),
  relation: (ids) => ({ relation: [].concat(ids).filter(Boolean).map((id) => ({ id })) }),
};

// Texto em blocos de parágrafo (limite de 2000 chars por bloco).
export function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((line) => line.match(/[\s\S]{1,1900}/g))
    .map((chunk) => ({
      object: 'block',
      type: chunk.startsWith('- ') ? 'bulleted_list_item' : 'paragraph',
      [chunk.startsWith('- ') ? 'bulleted_list_item' : 'paragraph']: {
        rich_text: [{ type: 'text', text: { content: chunk.replace(/^- /, '') } }],
      },
    }));
}

// Estrutura padrão de anotação de aula. O texto enviado entra em Tópicos.
const block = (type, text = '') => ({
  object: 'block', type, [type]: { rich_text: text ? [{ type: 'text', text: { content: text } }] : [] },
});
export function aulaTemplate(conteudo) {
  const topicos = paragraphs(conteudo);
  return [
    block('heading_3', '📌 Tópicos da aula'),
    ...(topicos.length ? topicos : [block('bulleted_list_item')]),
    block('heading_3', '❓ Dúvidas'),
    block('bulleted_list_item'),
    block('heading_3', '🎯 O que cai na prova'),
    block('bulleted_list_item'),
    block('heading_3', '🔗 Materiais e links'),
    block('paragraph'),
  ];
}

// ---------- leitura de propriedades ----------
export function read(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return prop[prop.type].map((t) => t.plain_text).join('');
    case 'number': return prop.number;
    case 'checkbox': return prop.checkbox;
    case 'select': return prop.select?.name ?? null;
    case 'status': return prop.status?.name ?? null;
    case 'date': return prop.date?.start ?? null;
    case 'relation': return prop.relation.map((r) => r.id);
    case 'formula': {
      const f = prop.formula;
      return f[f.type] ?? null;
    }
    case 'rollup': {
      const r = prop.rollup;
      if (r.type === 'number') return r.number;
      if (r.type === 'date') return r.date?.start ?? null;
      return r.array?.length ?? null;
    }
    default: return null;
  }
}

// Texto simples dos blocos de uma página (resultado de notion.children).
export const textoDosBlocos = (blocks, max = 4000) =>
  blocks.results
    .map((b) => (b[b.type]?.rich_text || []).map((t) => t.plain_text).join(''))
    .filter(Boolean).join('\n').slice(0, max);

export const titleOf = (page) => {
  const t = Object.values(page.properties).find((p) => p.type === 'title');
  return read(t);
};

export async function queryAll(dsId, body = {}) {
  const out = [];
  let cursor;
  do {
    const res = await notion.query(dsId, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && out.length < 500);
  return out;
}
