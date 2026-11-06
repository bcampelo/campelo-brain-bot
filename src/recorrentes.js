// Tarefas recorrentes: ao concluir uma tarefa com Repetir, cria a próxima.
import { DS, PERFIL_ID, notion, P, queryAll, read, titleOf } from './notion.js';
import { proximoPrazo, today } from './dates.js';
import { readJson, writeJson } from './store.js';

const FILE = 'recorrentes.json';
const emAndamento = new Set();

// Cria a próxima ocorrência de uma tarefa concluída. Devolve { titulo, prazo } ou null se não precisa.
// Serve ao concluir_tarefa e à varredura: o id já processado (auth/recorrentes.json) evita duplicar.
export async function criarProxima(page) {
  const pr = page.properties;
  const repetir = read(pr.Repetir);
  if (!repetir || emAndamento.has(page.id)) return null;
  const feitos = readJson(FILE, {});
  if (feitos[page.id]) return null;
  emAndamento.add(page.id);
  try {
    const titulo = titleOf(page);
    const prazo = read(pr.Prazo);
    const marcar = () => {
      feitos[page.id] = Date.now();
      for (const [id, t] of Object.entries(feitos)) if (Date.now() - t > 30 * 86400000) delete feitos[id];
      writeJson(FILE, feitos);
    };
    // Já existe uma aberta com o mesmo título e prazo posterior (criada à mão, por exemplo).
    const abertas = await queryAll(DS.tarefas, { filter: { and: [
      { property: 'Tarefa', title: { equals: titulo } },
      { property: 'Status', status: { does_not_equal: 'Feito' } },
    ] } });
    if (abertas.some((p) => (read(p.properties.Prazo) || '').slice(0, 10) > (prazo || '').slice(0, 10))) {
      marcar();
      return null;
    }
    const novoPrazo = proximoPrazo(prazo || today(), repetir);
    const props = {
      Tarefa: P.title(titulo),
      Status: P.status('A fazer'),
      Perfil: P.relation(PERFIL_ID),
      Prazo: P.date(novoPrazo),
      Repetir: P.select(repetir),
    };
    for (const nome of ['Prioridade', 'Área']) if (read(pr[nome])) props[nome] = P.select(read(pr[nome]));
    for (const nome of ['Matéria', 'Projeto']) if (read(pr[nome])?.length) props[nome] = P.relation(read(pr[nome]));
    await notion.create(DS.tarefas, props);
    marcar();
    return { titulo, prazo: novoPrazo };
  } finally {
    emAndamento.delete(page.id);
  }
}

// Tarefas concluídas direto no Notion nas últimas 48h.
export async function varrer() {
  const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
  const pages = await queryAll(DS.tarefas, { filter: { and: [
    { property: 'Status', status: { equals: 'Feito' } },
    { property: 'Repetir', select: { is_not_empty: true } },
    { timestamp: 'last_edited_time', last_edited_time: { on_or_after: desde } },
  ] } });
  let n = 0;
  for (const p of pages) {
    try { if (await criarProxima(p)) n++; } catch (e) { console.error('[recorrentes]', e.message); }
  }
  if (n) console.log(`[recorrentes] ${n} tarefa(s) recorrente(s) criada(s)`);
  return n;
}

let started = false;
export function startRecurring(everyMs = 30 * 60 * 1000) {
  if (started) return;
  started = true;
  const run = () => varrer().catch((e) => console.error('[recorrentes] falhou:', e.message));
  run();
  setInterval(run, everyMs);
}
