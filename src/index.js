import { config, assertConfig } from './config.js';
import { jidNormalizedUser } from 'baileys';
import { startWhatsApp, textOf, mediaInfo, isForwarded, quotedId, authorize, normNumber } from './whatsapp.js';
import { handleText, resetHistory, transcribe } from './agent.js';
import { runTool, catalog } from './tools.js';
import { nowParts, isBefore } from './dates.js';
import { startMaintenance } from './maintenance.js';
import { ctx } from './context.js';
import { startReminders } from './lembretes.js';
import { tratar, diarioPorAudio } from './comandos.js';
import { startRecurring } from './recorrentes.js';
import { bomDia } from './briefing.js';
import { rodarFechamento, respondeFechamento, concluirFechamento, instrucaoFechamento } from './fechamento.js';

assertConfig();

const HELP = `Manda do seu jeito. Exemplos
• estatística: prova segunda sobre regressão
• tirei 8,5 na prova 1 de SO
• tarefa: entregar relatório do cliente sexta, prioridade alta
• toda segunda pagar a academia (tarefa recorrente: diária, dias úteis, semanal ou mensal)
• anota aula de ED: árvores AVL balanceiam por rotação...
• o que anotei de SO sobre escalonamento? (pesquisa nas suas notas)
• fui na academia, treino B
• li 15 páginas
• gastei 32 no ifood
• o que tenho essa semana?
• meu status
• manda um áudio, uma foto de recibo ou encaminha uma mensagem
• cortar o cabelo amanhã às 15h (manda o arquivo pro Calendário e avisa 30 min antes)
• tarefa: ligar pro cliente hoje 16:30
• depois do aviso ⏰: +15, +1h, adiar 30 ou amanhã (ou responda ao aviso)

Comandos
/desfazer desfaz a última ação (/desfazer 3 desfaz as 3 últimas)
/diario <texto> escreve no diário de hoje (sem texto, mostra o que já escreveu). Áudio começando com "diário" também vai pra lá
/id, /reset, /ajuda

Automático
• 06:45 bom dia com clima, provas, tarefas, sequências de hábitos
• 21:30 "Como foi o dia?" Responda por texto ou áudio e eu registro no diário e nos hábitos
• Se eu perguntar 1 ou 2, é só responder o número`;

const MAX_MEDIA = 15 * 1024 * 1024;

// Fila por chat para não processar duas mensagens ao mesmo tempo.
const queues = new Map();
function enqueue(chat, job) {
  const prev = queues.get(chat) || Promise.resolve();
  const next = prev.then(job, job);
  queues.set(chat, next.finally(() => queues.get(chat) === next && queues.delete(chat)));
  return next;
}

let wakeCheckedOn = null;
async function maybeMarkWakeUp() {
  if (!config.autoWakeUp) return;
  const { date, time } = nowParts();
  if (wakeCheckedOn === date) return;
  wakeCheckedOn = date;
  if (isBefore(time, config.wakeUpLimit)) {
    const r = await runTool('marcar_habitos', { habitos: ['acordar'] });
    console.log('[auto] acordar antes do limite:', r.ok ? 'marcado' : r.error);
  }
}

async function onMessage(msg, wa) {
  const chat = msg.key.remoteJid;
  const text = textOf(msg);
  const allowed = authorize(msg, wa.me());

  if (/^\/id\b/i.test(text)) {
    console.log(`[id] chat=${chat} alt=${msg.key.remoteJidAlt || '-'} participant=${msg.key.participant || '-'} fromMe=${msg.key.fromMe}`);
    if (allowed || msg.key.fromMe || config.ownerNumbers.length === 0) {
      await wa.send(chat, `ID deste chat: ${chat}${msg.key.remoteJidAlt ? `\nAlternativo: ${msg.key.remoteJidAlt}` : ''}`, msg);
    }
    return;
  }
  if (!allowed) return;

  await enqueue(chat, async () => {
    await maybeMarkWakeUp();

    const info = mediaInfo(msg);
    if (!text && !info) return;
    if (/^\/(ajuda|help)\b/i.test(text)) return wa.send(chat, HELP, msg);
    if (/^\/reset\b/i.test(text)) {
      resetHistory(chat);
      await catalog(true);
      return wa.send(chat, 'Conversa e cache zerados.', msg);
    }

    const cmd = await tratar({ chat, text, quotedId: quotedId(msg) }).catch((e) => `Deu erro aqui: ${e.message.slice(0, 200)}`);
    if (cmd) return wa.send(chat, cmd, msg);

    await wa.typing(chat);
    const typingTimer = setInterval(() => wa.typing(chat), 8000);
    console.log(`[msg] ${info ? `<${info.kind}> ` : ''}${text.slice(0, 80)}`);
    try {
      let media = [];
      if (info) {
        if (info.size > MAX_MEDIA) return await wa.send(chat, 'Esse arquivo é grande demais. Manda um menor.', msg);
        media = [await wa.media(msg).catch((e) => { console.error('[mídia]', e.message); return null; })].filter(Boolean);
        if (!media.length) return await wa.send(chat, 'Não consegui baixar a mídia. Manda de novo.', msg);
      }
      let transcript;
      const audio = media.find((m) => m.kind === 'audio');
      if (audio) {
        transcript = await transcribe(chat, audio);
        const noDiario = await diarioPorAudio(chat, transcript);
        if (noDiario) return await wa.send(chat, noDiario, msg);
      }
      // Resposta ao fechamento do dia: a primeira mensagem que não é comando depois da pergunta.
      const fechando = respondeFechamento(chat, text);
      const reply = await ctx.run({ chat, wa }, () => handleText(chat, text, { media, forwarded: isForwarded(msg), transcript, ...(fechando ? { instrucao: instrucaoFechamento } : {}) }));
      if (fechando) concluirFechamento();
      console.log(`[resposta] ${reply.slice(0, 120).replace(/\n/g, ' ')}`);
      await wa.send(chat, reply, msg);
    } catch (e) {
      console.error('[erro]', e.message);
      await wa.send(chat, `Deu erro aqui: ${e.message.slice(0, 200)}`, msg).catch((err) => console.error('[erro ao responder]', err.message));
    } finally {
      clearInterval(typingTimer);
      wa.sock.sendPresenceUpdate('paused', chat).catch(() => {});
    }
  });
}

// Resumo diário no horário configurado.
let schedulerOn = false;
function pickTarget(selfJid, preferred = '') {
  const selfIsOwner = config.ownerNumbers.some((n) => normNumber(n) === normNumber(selfJid.split('@')[0]));
  return (
    preferred ||
    config.dailySummaryChat ||
    config.allowedChats[0] ||
    (config.allowFromMe || selfIsOwner ? selfJid : null) ||
    (config.ownerNumbers[0] ? `${config.ownerNumbers[0]}@s.whatsapp.net` : null)
  );
}

function startScheduler(wa, selfJid) {
  if (schedulerOn || !config.dailySummaryTime) return;
  const target = pickTarget(selfJid);
  if (!target) return console.warn('Resumo diário sem chat de destino. Defina RESUMO_CHAT.');
  schedulerOn = true;
  let sentOn = null;
  setInterval(async () => {
    const { date, time } = nowParts();
    if (time !== config.dailySummaryTime || sentOn === date) return;
    sentOn = date;
    try {
      const reply = config.briefing
        ? await bomDia((instrucao) => handleText(`resumo:${target}`, instrucao, { semTools: true }))
        : await handleText(`resumo:${target}`,
          'Monte meu resumo de hoje. Use consultar_agenda com 3 dias. Mostre provas, tarefas de hoje e atrasadas, e quais hábitos faltam. Curto, em lista com •.');
      await wa.send(target, reply);
    } catch (e) {
      console.error('Falha no resumo diário:', e.message);
    }
  }, 20_000);
  console.log(`Resumo diário às ${config.dailySummaryTime} para ${target}`);
}

let fechamentoOn = false;
function startFechamento(wa, selfJid) {
  if (fechamentoOn || !config.fechamentoHora) return;
  const target = pickTarget(selfJid);
  if (!target) return;
  fechamentoOn = true;
  setInterval(() => rodarFechamento(wa.send, target).catch((e) => console.error('Falha no fechamento:', e.message)), 60_000);
  console.log(`Fechamento do dia às ${config.fechamentoHora} para ${target}`);
}

let current;
startWhatsApp({
  onMessage: (msg, wa) => onMessage(msg, wa),
  onReady: (wa) => {
    current = wa;
    const selfJid = jidNormalizedUser(wa.sock.user.id);
    const viaAtual = { send: (...a) => current.send(...a) };
    startScheduler(viaAtual, selfJid);
    startFechamento(viaAtual, selfJid);
    const remindTo = pickTarget(selfJid, config.reminderChat);
    if (remindTo) startReminders((text) => current.send(remindTo, text));
    catalog(true).then(
      (c) => {
        console.log(`Notion ok. ${c.materias.length} matérias, ${c.projetos.length} projetos. IA: ${config.provider}.`);
        startMaintenance();
        startRecurring();
      },
      (e) => console.error('Notion falhou. Libere o Campelo Brain para a integração em ... > Conexões e mande /reset.', e.message),
    );
  },
});
