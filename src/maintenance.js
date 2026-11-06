// Manutenção automática do Notion, roda de tempos em tempos.
import { DS, PERFIL_ID, notion, P, queryAll, aulaTemplate } from './notion.js';
import { today, addDays } from './dates.js';

// Itens criados à mão no Notion sem o Perfil não somam XP. Aqui eles são ligados ao Perfil.
export async function linkOrphans() {
  let total = 0;
  for (const base of ['tarefas', 'avaliacoes', 'livros', 'diario']) {
    try {
      const pages = await queryAll(DS[base], { filter: { property: 'Perfil', relation: { is_empty: true } } });
      for (const p of pages) {
        await notion.update(p.id, { Perfil: P.relation(PERFIL_ID) });
        total++;
      }
    } catch (e) {
      console.error(`[manutenção] ${base}:`, e.message);
    }
  }
  return total;
}

// Matéria com Término no passado vira Concluída.
export async function concludeFinished() {
  const pages = await queryAll(DS.materias, {
    filter: { and: [
      { property: 'Status', select: { equals: 'Cursando' } },
      { property: 'Término', date: { before: today() } },
    ] },
  });
  for (const p of pages) await notion.update(p.id, { Status: P.select('Concluída') });
  return pages.length;
}

// Nota de aula criada à mão no Notion e ainda vazia ganha a estrutura padrão.
export async function fillEmptyAulas() {
  const pages = await queryAll(DS.notas, {
    filter: { and: [
      { property: 'Tipo', select: { equals: 'Aula' } },
      { property: 'Criada em', created_time: { on_or_after: addDays(today(), -2) } },
    ] },
  });
  let n = 0;
  for (const p of pages) {
    const kids = await notion.children(p.id);
    if (kids.results.length) continue;
    await notion.append(p.id, aulaTemplate(''));
    n++;
  }
  return n;
}

export async function runMaintenance() {
  try {
    const linked = await linkOrphans();
    const concluded = await concludeFinished();
    const aulas = await fillEmptyAulas().catch((e) => (console.error('[manutenção] aulas:', e.message), 0));
    if (linked || concluded || aulas) console.log(`[manutenção] ${linked} itens ligados ao Perfil, ${concluded} matérias concluídas, ${aulas} aulas com modelo`);
    return { linked, concluded, aulas };
  } catch (e) {
    console.error('[manutenção] falhou:', e.message);
    return null;
  }
}

let started = false;
export function startMaintenance(everyMs = 15 * 60 * 1000) {
  if (started) return;
  started = true;
  runMaintenance();
  setInterval(runMaintenance, everyMs);
}
