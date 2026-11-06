// Fechamento do dia: o bot pergunta como foi o dia e a próxima resposta do dono vira diário e hábitos.
import { config } from './config.js';
import { readJson, writeJson } from './store.js';
import { nowParts, addDays } from './dates.js';
import { HABITOS, diaryRow } from './tools.js';
import { notion, read, textoDosBlocos } from './notion.js';

const ARQ = 'fechamento.json';
const LIMITE = '03:00'; // a janela vale até as 03:00 do dia seguinte

// Função pura: a pergunta ainda espera resposta?
export function janelaAberta(estado, agora = nowParts()) {
  if (!estado?.aguardando) return false;
  return agora.date === estado.data || (agora.date === addDays(estado.data, 1) && agora.time < LIMITE);
}

export const textoPergunta = (faltam) =>
  `Como foi o dia? Pode mandar por áudio.${faltam.length ? `\nAinda sem marcar hoje: ${faltam.join(', ')}.` : ''}`;

export const instrucaoFechamento = 'Esta mensagem é a resposta ao fechamento do dia. Escreva o relato no diário com escrever_diario. Marque com marcar_habitos só os hábitos que eu disse que fiz. Registre leitura e treino se eu citei. Não crie tarefas, provas nem outros itens a menos que eu peça. Responda em até 3 linhas dizendo o que foi registrado.';

// Manda a pergunta uma vez por dia, a partir de FECHAMENTO_HORA. Devolve true se mandou.
export async function rodarFechamento(send, chat, agora = nowParts()) {
  const hora = config.fechamentoHora;
  if (!hora || agora.time < hora) return false;
  if (readJson(ARQ, {}).data === agora.date) return false;
  const row = await diaryRow(agora.date);
  if (textoDosBlocos(await notion.children(row.id))) return false; // já escreveu o diário hoje
  const faltam = Object.values(HABITOS).filter((h) => !read(row.properties[h]));
  await send(chat, textoPergunta(faltam));
  writeJson(ARQ, { data: agora.date, chat, aguardando: true });
  return true;
}

// Fechamento esperando resposta neste chat (ou null).
export function fechamentoAberto(chat, agora = nowParts()) {
  const e = readJson(ARQ, null);
  return e && e.chat === chat && janelaAberta(e, agora) ? e : null;
}

export const concluirFechamento = () => writeJson(ARQ, { ...readJson(ARQ, {}), aguardando: false });

// Esta mensagem é a resposta ao fechamento? Comandos (/...) nunca consomem.
export const respondeFechamento = (chat, text, agora) => !text.startsWith('/') && !!fechamentoAberto(chat, agora);
