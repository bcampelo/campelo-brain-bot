// Briefing do "bom dia": os dados são coletados em código, a IA só redige o texto.
import { config } from './config.js';
import { DS, queryAll, read } from './notion.js';
import { today, addDays } from './dates.js';
import { _impl, HABITOS } from './tools.js';

// Sem CLIMA_LAT e CLIMA_LON no .env, o bom dia sai sem clima.
function climaUrl() {
  if (!config.climaLat || !config.climaLon) return null;
  return `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(config.climaLat)}&longitude=${encodeURIComponent(config.climaLon)}`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=${encodeURIComponent(config.tz)}`;
}

let fetchImpl = (...a) => fetch(...a);
export function setBriefingFetch(fn) { fetchImpl = fn; }

export async function clima() {
  try {
    const url = climaUrl();
    if (!url) return null;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = (await res.json()).daily;
    return { minima: Math.round(d.temperature_2m_min[0]), maxima: Math.round(d.temperature_2m_max[0]), chuva: d.precipitation_probability_max[0] };
  } catch { return null; }
}

export const diasRestantes = (hoje, data) => Math.round((new Date(`${data.slice(0, 10)}T12:00:00Z`) - new Date(`${hoje}T12:00:00Z`)) / 86400000);

// dias: { 'YYYY-MM-DD': { [coluna]: boolean } }. Conta os dias seguidos terminando em ontem; dia sem linha conta como não feito.
export function sequencia(dias, coluna, hoje) {
  let n = 0;
  for (let d = addDays(hoje, -1); dias[d]?.[coluna]; d = addDays(d, -1)) n++;
  return n;
}

export function montarBriefing({ hoje, clima: cl, agenda, dias }) {
  const ontem = dias[addDays(hoje, -1)] || {};
  const colunas = Object.values(HABITOS);
  const notas = [];
  if (!ontem.treino && !ontem['Atividade física']) notas.push('ontem não teve treino');
  if (!ontem.paginas) notas.push('ontem não teve leitura');
  return {
    hoje,
    clima: cl,
    provas: (agenda.avaliacoes || []).map((a) => ({ ...a, faltam_dias: diasRestantes(hoje, a.data) })).filter((a) => a.faltam_dias <= 7),
    tarefas: (agenda.tarefas || []).filter((t) => t.prazo && t.prazo.slice(0, 10) <= hoje),
    habitos_sem_marcar_ontem: colunas.filter((c) => !ontem[c]),
    sequencias: Object.fromEntries(colunas.map((c) => [c, sequencia(dias, c, hoje)])),
    notas,
  };
}

export async function coletarBriefing() {
  const hoje = today();
  const [cl, agenda, rows] = await Promise.all([
    clima(),
    _impl.consultar_agenda({ dias: 7 }),
    queryAll(DS.diario, { filter: { property: 'Data', date: { on_or_after: addDays(hoje, -14) } } }),
  ]);
  const dias = {};
  for (const p of rows) {
    const data = read(p.properties.Data)?.slice(0, 10);
    if (!data) continue;
    dias[data] = { treino: read(p.properties.Treino), paginas: read(p.properties['Páginas lidas']) || 0 };
    for (const c of Object.values(HABITOS)) dias[data][c] = !!read(p.properties[c]);
  }
  return montarBriefing({ hoje, clima: cl, agenda, dias });
}

// Texto fixo, usado quando a IA falha.
export function textoFixo(b) {
  const l = ['Bom dia! Resumo de hoje'];
  if (b.clima) l.push(`• Clima: ${b.clima.minima}° a ${b.clima.maxima}°, ${b.clima.chuva}% de chuva`);
  if (b.provas.length) l.push('Provas e trabalhos', ...b.provas.map((p) => `• ${p.avaliacao}${p.materia ? ` (${p.materia})` : ''}, ${p.faltam_dias === 0 ? 'hoje' : p.faltam_dias === 1 ? 'amanhã' : `em ${p.faltam_dias} dias`}`));
  if (b.tarefas.length) l.push('Tarefas', ...b.tarefas.map((t) => `• ${t.tarefa}${t.atrasada ? ' (atrasada)' : ''}`));
  const seq = Object.entries(b.sequencias).filter(([, n]) => n > 0).map(([h, n]) => `${h}: ${n} dia${n > 1 ? 's' : ''}`);
  if (seq.length) l.push(`Sequências: ${seq.join(', ')}`);
  if (b.habitos_sem_marcar_ontem.length) l.push(`Ontem ficou sem marcar: ${b.habitos_sem_marcar_ontem.join(', ')}`);
  if (b.notas.length) l.push(`Obs: ${b.notas.join(', ')}`);
  return l.join('\n');
}

export const instrucaoBriefing = (b) => `Escreva meu bom dia com base nestes dados (JSON). Mensagem curta, em português simples, sem emojis em excesso, lista com • quando listar. Só use o que está nos dados. Se houver "notas", faça a cobrança em uma frase só, leve. Sem notas, não cobre nada.\n${JSON.stringify(b)}`;

// Briefing pronto para enviar. Nunca lança: se a coleta ou a IA falhar, cai no texto fixo (ou numa mensagem mínima).
export async function bomDia(redigir) {
  let b;
  try { b = await coletarBriefing(); } catch (e) {
    console.error('[briefing] coleta falhou:', e.message);
    return 'Bom dia! Não consegui montar o resumo agora. Manda "o que tenho essa semana?" que eu vejo.';
  }
  try {
    const texto = await redigir(instrucaoBriefing(b));
    if (texto) return texto;
  } catch (e) { console.error('[briefing] IA falhou:', e.message); }
  return textoFixo(b);
}
