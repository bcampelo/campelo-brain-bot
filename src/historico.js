// Histórico de escritas no Notion por chat, para o /desfazer.
// notion.create e notion.update são envolvidos: dentro de uma mensagem (ctx) cada escrita vira um registro.
import { DS, notion, titleOf } from './notion.js';
import { ctx } from './context.js';
import { readJson, writeJson } from './store.js';

const FILE = 'historico.json';
const MAX = 20;
const NOME = {
  tarefas: 'tarefa', avaliacoes: 'avaliação', notas: 'nota', lancamentos: 'lançamento', materias: 'matéria',
  projetos: 'projeto', livros: 'livro', diario: 'diário', recompensas: 'recompensa', ficha_treino: 'exercício', areas: 'área',
};
const baseDe = (dsId) => Object.keys(DS).find((k) => DS[k].replace(/-/g, '') === String(dsId || '').replace(/-/g, ''));

export function registrar(chat, entrada) {
  const all = readJson(FILE, {});
  all[chat] = [...(all[chat] || []), entrada].slice(-MAX);
  writeJson(FILE, all);
}

// Propriedade lida da API -> formato de escrita, para restaurar valores antigos.
export function paraEscrita(prop) {
  switch (prop?.type) {
    case 'title':
    case 'rich_text': return { [prop.type]: prop[prop.type].map((t) => ({ text: { content: t.plain_text } })) };
    case 'number': return { number: prop.number };
    case 'checkbox': return { checkbox: prop.checkbox };
    case 'select': return { select: prop.select ? { name: prop.select.name } : null };
    case 'status': return prop.status ? { status: { name: prop.status.name } } : null;
    case 'multi_select': return { multi_select: prop.multi_select.map((o) => ({ name: o.name })) };
    case 'date': return { date: prop.date ? { start: prop.date.start, end: prop.date.end || null } : null };
    case 'relation': return { relation: prop.relation.map((r) => ({ id: r.id })) };
    case 'url': case 'email': case 'phone_number': return { [prop.type]: prop[prop.type] };
    default: return null; // fórmula, rollup etc. não são editáveis
  }
}

let instalado = false;
export function instalar() {
  if (instalado) return;
  instalado = true;
  const { create, update } = notion;

  notion.create = async (dsId, properties, children) => {
    const page = await create(dsId, properties, children);
    const chat = ctx.getStore()?.chat;
    const base = baseDe(dsId);
    // Linha do dia no Diário é criada por infraestrutura, não pelo usuário: fica de fora.
    if (chat && base && base !== 'diario') {
      const titulo = titleOf(page) || Object.values(properties).find((p) => p.title)?.title[0]?.text.content;
      registrar(chat, { tipo: 'criou', pageId: page.id, base, titulo });
    }
    return page;
  };

  notion.update = async (pageId, properties) => {
    const chat = ctx.getStore()?.chat;
    let entrada;
    if (chat) {
      try {
        const antes = await notion.page(pageId);
        const props = {};
        for (const nome of Object.keys(properties)) {
          const v = paraEscrita(antes.properties[nome]);
          if (v) props[nome] = v;
        }
        entrada = { tipo: 'editou', pageId, base: baseDe(antes.parent?.data_source_id), titulo: titleOf(antes), antes: props };
      } catch (e) { console.error('[histórico] não leu a página antes de editar:', e.message); }
    }
    const out = await update(pageId, properties);
    if (entrada) registrar(chat, entrada);
    return out;
  };
}

export async function desfazer(chat, n = 1) {
  const all = readJson(FILE, {});
  const lista = all[chat] || [];
  if (!lista.length) return 'Nada para desfazer.';
  const msgs = [];
  for (let i = 0; i < n && lista.length; i++) {
    const e = lista.pop();
    const nome = `${NOME[e.base] || 'item'} "${e.titulo || '?'}"`;
    try {
      if (e.tipo === 'criou') {
        await notion.trash(e.pageId);
        msgs.push(`Desfeito: ${nome} apagada.`);
      } else {
        await notion.update(e.pageId, e.antes);
        msgs.push(`Desfeito: edição em ${nome}, valores antigos restaurados.`);
      }
    } catch (err) {
      msgs.push(`Não consegui desfazer ${nome}: ${err.message.slice(0, 120)}`);
    }
  }
  all[chat] = lista;
  writeJson(FILE, all);
  return msgs.join('\n');
}
