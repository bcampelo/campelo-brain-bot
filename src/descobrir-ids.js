// Descobre os IDs das databases do Campelo Brain e imprime as linhas prontas para o .env.
// Uso: npm run ids   (precisa de NOTION_TOKEN no .env e da integração conectada na página Campelo Brain)
import 'dotenv/config';
import { pathToFileURL } from 'node:url';

const API = 'https://api.notion.com/v1';
const VERSION = '2025-09-03';

// Chave do .env (NOTION_DS_<CHAVE>) e os títulos que ela costuma ter no Notion.
export const CHAVES = {
  perfil: ['perfil'],
  materias: ['materias'],
  projetos: ['projetos'],
  livros: ['livros', 'leitura'],
  avaliacoes: ['avaliacoes', 'provas'],
  tarefas: ['tarefas'],
  notas: ['notas'],
  diario: ['diario'],
  lancamentos: ['lancamentos', 'financas'],
  recompensas: ['recompensas', 'loja'],
  ficha_treino: ['ficha de treino', 'ficha treino', 'treino', 'academia'],
  areas: ['areas'],
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function tituloDe(obj) {
  const t = obj?.title ?? obj?.name;
  if (Array.isArray(t)) return t.map((x) => x.plain_text ?? x.text?.content ?? '').join('');
  return typeof t === 'string' ? t : '';
}

const tituloDaPagina = (p) => tituloDe(Object.values(p?.properties || {}).find((x) => x.type === 'title'));

// Liga cada chave ao data source de mesmo título. Primeiro título igual, depois título que contém a palavra.
export function casar(fontes) {
  const lista = fontes.map((f) => ({ id: f.id, titulo: tituloDe(f), n: norm(tituloDe(f)) }));
  const achados = {}, ambiguos = {}, faltando = [];
  for (const [chave, apelidos] of Object.entries(CHAVES)) {
    let c = lista.filter((f) => apelidos.includes(f.n));
    if (!c.length) c = lista.filter((f) => apelidos.some((a) => ` ${f.n} `.includes(` ${a} `)));
    if (c.length === 1) achados[chave] = c[0].id;
    else if (c.length > 1) ambiguos[chave] = c.map((f) => ({ titulo: f.titulo, id: f.id }));
    else faltando.push(chave);
  }
  return { achados, ambiguos, faltando };
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function buscarFontes() {
  const out = [];
  let cursor;
  do {
    const r = await call('POST', '/search', { filter: { property: 'object', value: 'data_source' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('Coloque o NOTION_TOKEN no .env antes de rodar.');
    process.exit(1);
  }
  const fontes = await buscarFontes();
  if (!fontes.length) {
    console.error('A integração não enxerga nenhuma database. Abra a página Campelo Brain no Notion, clique em ... > Conexões e adicione a sua integração.');
    process.exit(1);
  }
  const { achados, ambiguos, faltando } = casar(fontes);
  const linhas = Object.keys(CHAVES).filter((k) => achados[k]).map((k) => `NOTION_DS_${k.toUpperCase()}=${achados[k]}`);

  // A sua página no Perfil. Só dá para escolher sozinho se houver uma.
  let perfilLinha = '';
  const problemas = [];
  if (achados.perfil) {
    const r = await call('POST', `/data_sources/${achados.perfil}/query`, { page_size: 10 });
    const paginas = r.results.map((p) => ({ id: p.id, titulo: tituloDaPagina(p) }));
    if (paginas.length === 1) perfilLinha = `NOTION_PERFIL_ID=${paginas[0].id}`;
    else problemas.push(paginas.length ? `Há ${paginas.length} páginas no Perfil. Escolha a sua e coloque NOTION_PERFIL_ID=<id>:\n${paginas.map((p) => `   ${p.titulo || '(sem título)'}  ${p.id}`).join('\n')}` : 'O Perfil está vazio. Crie a sua página nele e rode de novo.');
  }
  if (perfilLinha) linhas.push(perfilLinha);

  console.log('Cole estas linhas no seu .env\n');
  console.log(linhas.join('\n'));
  for (const [k, c] of Object.entries(ambiguos)) problemas.push(`Mais de uma database parece ser "${k}". Escolha uma e coloque NOTION_DS_${k.toUpperCase()}=<id>:\n${c.map((x) => `   ${x.titulo}  ${x.id}`).join('\n')}`);
  if (faltando.length) problemas.push(`Não achei: ${faltando.join(', ')}. Confira se a integração está conectada na página Campelo Brain e se os títulos das databases não foram renomeados.`);
  if (problemas.length) {
    console.error(`\nAtenção\n${problemas.join('\n\n')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
