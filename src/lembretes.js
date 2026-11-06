// Lembretes antes de tarefas com horário e geração de arquivo .ics para o Calendário da Apple.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { DS, notion, P, queryAll, read, titleOf } from './notion.js';
import { today, addDays, nowParts, humanDate } from './dates.js';

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Arquivo de calendário. No iPhone e no Mac, abrir o arquivo oferece "Adicionar ao Calendário".
export function buildIcs({ titulo, inicio, duracaoMin = 60, local, descricao, alarmeMin = 30 }) {
  const start = new Date(inicio);
  const end = new Date(start.getTime() + duracaoMin * 60000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Campelo Brain//brain-bot//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${randomUUID()}@brain-bot`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${esc(titulo)}`,
    ...(local ? [`LOCATION:${esc(local)}`] : []),
    ...(descricao ? [`DESCRIPTION:${esc(descricao)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(titulo)}`, `TRIGGER:-PT${alarmeMin}M`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// Decide quais itens precisam de aviso agora. Função pura, fácil de testar.
export function dueReminders(items, now, antes, notified) {
  const out = [];
  for (const { id, titulo, inicio, prop } of items) {
    if (!inicio || inicio.length <= 10) continue; // só itens com horário
    const key = `${id}|${inicio}`;
    if (notified[key]) continue;
    const mins = (new Date(inicio) - now) / 60000;
    if (mins > antes || mins < -2) continue;
    out.push({ key, id, prop, titulo, faltam: Math.max(0, Math.round(mins)), hora: nowParts(new Date(inicio)).time });
  }
  return out;
}

const storeFile = () => path.join(config.authDir, 'lembretes.json');
function loadStore() {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return {}; }
}
function saveStore(s) {
  try {
    fs.mkdirSync(config.authDir, { recursive: true });
    fs.writeFileSync(storeFile(), JSON.stringify(s));
  } catch (e) { console.error('[lembretes] não salvou', e.message); }
}

async function upcoming() {
  const from = today();
  const to = addDays(from, 1);
  const items = [];
  const tarefas = await queryAll(DS.tarefas, { filter: { and: [
    { property: 'Status', status: { does_not_equal: 'Feito' } },
    { property: 'Prazo', date: { on_or_after: from } },
    { property: 'Prazo', date: { on_or_before: to } },
  ] } });
  for (const p of tarefas) items.push({ id: p.id, titulo: titleOf(p), inicio: read(p.properties.Prazo), prop: 'Prazo' });
  const avs = await queryAll(DS.avaliacoes, { filter: { and: [
    { property: 'Data', date: { on_or_after: from } },
    { property: 'Data', date: { on_or_before: to } },
  ] } }).catch(() => []);
  for (const p of avs) items.push({ id: p.id, titulo: titleOf(p), inicio: read(p.properties.Data), prop: 'Data' });
  return items;
}

// O arquivo guarda, além das chaves "id|inicio" já avisadas, __avisos (mensagens enviadas, para responder
// com +15 ou citação) e __adiados (novos avisos agendados).
async function avisar(send, store, texto, { pageId, titulo, prop }) {
  const out = await send(texto);
  (store.__avisos ||= []).push({ msgId: out?.key?.id, pageId, titulo, prop, at: Date.now() });
}

export async function checkReminders(send, now = new Date()) {
  const store = loadStore();
  const due = dueReminders(await upcoming(), now, config.reminderMinutes, store);
  for (const d of due) {
    const quando = d.faltam <= 1 ? 'agora' : `em ${d.faltam} min`;
    await avisar(send, store, `⏰ ${d.titulo} ${quando} (${d.hora})`, { pageId: d.id, titulo: d.titulo, prop: d.prop });
    store[d.key] = Date.now();
  }
  const vencidos = (store.__adiados || []).filter((a) => a.quando <= now.getTime());
  if (vencidos.length) store.__adiados = store.__adiados.filter((a) => !vencidos.includes(a));
  for (const a of vencidos) await avisar(send, store, `⏰ ${a.titulo} (adiado)`, a);
  if (due.length || vencidos.length) {
    for (const [k, t] of Object.entries(store)) if (!k.startsWith('__') && Date.now() - t > 2 * 86400000) delete store[k];
    store.__avisos = (store.__avisos || []).filter((a) => Date.now() - a.at < 2 * 86400000);
    saveStore(store);
  }
  return due.length + vencidos.length;
}

// ---------- adiar aviso ----------
// "+15", "+1h", "adiar 30" adiam o aviso em minutos; "amanhã" move o Prazo para o dia seguinte.
export function parseAdiar(text) {
  const t = String(text || '').trim();
  if (/^(?:adiar\s+(?:para\s+)?)?amanh[ãa]$/i.test(t)) return { amanha: true };
  const m = t.match(/^(?:\+|adiar\s+)(\d+(?:[.,]\d+)?)\s*(h|horas?|min|m|minutos?)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')) * (/^h/i.test(m[2] || '') ? 60 : 1);
  return Math.round(n) > 0 ? { minutos: Math.round(n) } : null;
}

// Aviso citado, ou o último enviado nos últimos 30 min.
export function achaAviso(avisos, quotedId, agora) {
  if (quotedId) return avisos.find((a) => a.msgId === quotedId) || null;
  return avisos.filter((a) => agora - a.at <= 30 * 60000).at(-1) || null;
}

// Devolve a resposta, ou null se a mensagem não é um pedido de adiar ligado a um aviso.
export async function adiar(text, quotedId, agora = Date.now()) {
  const p = parseAdiar(text);
  if (!p) return null;
  const store = loadStore();
  const aviso = achaAviso(store.__avisos || [], quotedId, agora);
  if (!aviso) return null;
  if (p.minutos) {
    const quando = agora + p.minutos * 60000;
    (store.__adiados ||= []).push({ pageId: aviso.pageId, titulo: aviso.titulo, prop: aviso.prop, quando });
    saveStore(store);
    return `Beleza, te aviso de "${aviso.titulo}" às ${nowParts(new Date(quando)).time}.`;
  }
  if (aviso.prop !== 'Prazo') return `"${aviso.titulo}" é uma avaliação, não mexo na data. Dá pra adiar o aviso em minutos (+15, +1h).`;
  const atual = read((await notion.page(aviso.pageId)).properties.Prazo);
  if (!atual) return `"${aviso.titulo}" está sem Prazo, não tenho o que mover.`;
  const novo = addDays(atual.slice(0, 10), 1) + atual.slice(10);
  await notion.update(aviso.pageId, { Prazo: P.date(novo) });
  return `Ok, "${aviso.titulo}" ficou para amanhã (${humanDate(novo)}${novo.length > 10 ? ` ${nowParts(new Date(novo)).time}` : ''}).`;
}

let started = false;
export function startReminders(send, everyMs = 60_000) {
  if (started || !config.reminderMinutes) return;
  started = true;
  setInterval(() => checkReminders(send).catch((e) => console.error('[lembretes]', e.message)), everyMs);
  console.log(`Lembretes ${config.reminderMinutes} min antes de tarefas e provas com horário.`);
}
