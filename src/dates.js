import { config } from './config.js';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEK_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Partes da data/hora atual no fuso configurado.
export function nowParts(date = new Date(), tz = config.tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const today = (d) => nowParts(d).date;

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

// Título usado nas linhas do Diário. Ex: "Sex, 31/10".
export function diaryTitle(isoDate) {
  const [, m, d] = isoDate.split('-');
  return `${WEEK[weekday(isoDate)]}, ${d}/${m}`;
}

export function humanDate(isoDate) {
  const [, m, d] = isoDate.slice(0, 10).split('-');
  return `${WEEK[weekday(isoDate.slice(0, 10))].toLowerCase()} ${d}/${m}`;
}

// Calendário dos próximos dias para a IA não errar "segunda que vem".
export function calendarHint(base = today(), days = 21) {
  const lines = [];
  for (let i = 0; i < days; i++) {
    const iso = addDays(base, i);
    const tag = i === 0 ? ' (hoje)' : i === 1 ? ' (amanhã)' : '';
    lines.push(`${iso} ${WEEK_FULL[weekday(iso)]}${tag}`);
  }
  return lines.join('\n');
}

export function isBefore(time, limit) {
  return time < limit; // strings HH:MM comparam certo
}

// Deslocamento do fuso (ex: "-05:00") para uma data e hora locais.
export function tzOffset(date, time, tz = config.tz) {
  const guess = new Date(`${date}T${time}:00Z`);
  const p = nowParts(guess, tz);
  const mins = Math.round((new Date(`${p.date}T${p.time}:00Z`) - guess) / 60000);
  const a = Math.abs(mins);
  return `${mins < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// "2026-11-02" + "15:00" -> "2026-11-02T15:00:00-05:00"
export const withTime = (date, time) => `${date}T${time}:00${tzOffset(date, time)}`;

// Próximo prazo de uma tarefa recorrente. Mantém a parte da hora (T15:00:00-05:00) se houver.
// Mensal usa o mesmo dia no mês seguinte, ou o último dia se o mês for menor (31/01 -> 28/02).
export function proximoPrazo(prazoISO, repetir) {
  const dia = prazoISO.slice(0, 10);
  const resto = prazoISO.slice(10);
  let novo;
  if (repetir === 'Diária') novo = addDays(dia, 1);
  else if (repetir === 'Semanal') novo = addDays(dia, 7);
  else if (repetir === 'Dias úteis') {
    novo = addDays(dia, 1);
    while ([0, 6].includes(weekday(novo))) novo = addDays(novo, 1);
  } else if (repetir === 'Mensal') {
    const [y, m, d] = dia.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m (1-based) é o índice do mês seguinte
    novo = new Date(Date.UTC(y, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
  } else return null;
  return novo + resto;
}
