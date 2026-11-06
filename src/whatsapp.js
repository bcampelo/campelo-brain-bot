import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  jidNormalizedUser,
  downloadMediaMessage,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from './config.js';

const logger = pino({ level: process.env.BAILEYS_LOG || 'warn' });

export function textOf(msg) {
  const m = msg.message || {};
  const inner = m.ephemeralMessage?.message || m.viewOnceMessageV2?.message || m;
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.documentMessage?.caption ||
    ''
  ).trim();
}

const inner = (msg) => {
  const m = msg.message || {};
  return m.ephemeralMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessage?.message || m;
};

export const isAudio = (msg) => !!inner(msg).audioMessage;
export const isImage = (msg) => !!inner(msg).imageMessage;

// Tamanho e tipo da mídia, para decidir se vale baixar.
export function mediaInfo(msg) {
  const m = inner(msg);
  const part = m.audioMessage || m.imageMessage;
  if (!part) return null;
  return {
    kind: m.audioMessage ? 'audio' : 'image',
    mimeType: String(part.mimetype || (m.audioMessage ? 'audio/ogg' : 'image/jpeg')).split(';')[0],
    size: Number(part.fileLength || 0),
  };
}

// Id da mensagem que esta responde (citação), para ligar "+15" ao aviso de lembrete.
export const quotedId = (msg) => inner(msg).extendedTextMessage?.contextInfo?.stanzaId || null;

// Mensagem marcada como encaminhada no WhatsApp.
export function isForwarded(msg) {
  const m = inner(msg);
  const part = m.extendedTextMessage || m.imageMessage || m.audioMessage || m.videoMessage || m.documentMessage;
  return !!part?.contextInfo?.isForwarded;
}

// Números do Brasil às vezes chegam sem o nono dígito (5511998887777 vs 551198887777).
// Normaliza tirando o 9 para comparar os dois formatos.
export function normNumber(n) {
  const d = String(n || '').replace(/\D/g, '');
  return /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d;
}
const digits = (jid) => normNumber((jid || '').split('@')[0].split(':')[0]);

// Decide se a mensagem deve ser processada.
export function authorize(msg, me, cfg = config) {
  const k = msg.key;
  const chat = k.remoteJid;
  const isGroup = chat.endsWith('@g.us');
  const chatAllowed = cfg.allowedChats.includes(chat) || (!!k.remoteJidAlt && cfg.allowedChats.includes(k.remoteJidAlt));

  if (k.fromMe) {
    const selfIds = [me.id, me.lid].filter(Boolean).map((j) => digits(j));
    // Se o bot roda no próprio número do dono, conversar consigo mesmo já vale.
    const selfIsOwner = cfg.ownerNumbers.map(normNumber).some((o) => selfIds.includes(o));
    if (!cfg.allowFromMe && !selfIsOwner) return false;
    const isSelfChat = selfIds.includes(digits(chat)) || selfIds.includes(digits(k.remoteJidAlt));
    return isSelfChat || chatAllowed;
  }

  const senderIds = isGroup ? [k.participant, k.participantAlt] : [chat, k.remoteJidAlt];
  const owners = cfg.ownerNumbers.map(normNumber);
  const isOwner = senderIds.some((j) => j && owners.includes(digits(j)));
  if (isGroup) return chatAllowed && (isOwner || cfg.ownerNumbers.length === 0);
  return isOwner || chatAllowed;
}

export async function startWhatsApp({ onMessage, onReady }) {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await Promise.race([
    fetchLatestBaileysVersion(),
    new Promise((r) => setTimeout(() => r({}), 5000)),
  ]).catch(() => ({}));
  console.log('Conectando ao WhatsApp...');
  const sent = new Set();
  const seen = new Set();

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  let pairingAsked = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      if (config.pairingNumber && !state.creds.registered && !pairingAsked) {
        pairingAsked = true;
        const code = await sock.requestPairingCode(config.pairingNumber);
        console.log(`\nCódigo de vinculação: ${code}\nNo celular: WhatsApp > Dispositivos conectados > Conectar com número de telefone.\n`);
      } else if (!config.pairingNumber) {
        console.log('\nEscaneie o QR no WhatsApp > Dispositivos conectados > Conectar dispositivo:\n');
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      console.log(`WhatsApp conectado como ${jidNormalizedUser(sock.user.id)}`);
      onReady?.(api);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.error('Sessão desconectada pelo celular. Apague a pasta auth e vincule de novo.');
        process.exit(1);
      }
      console.log(`Conexão caiu (${code ?? 'sem código'}). Reconectando...`);
      setTimeout(() => startWhatsApp({ onMessage, onReady }), 3000);
    }
  });

  const api = {
    sock,
    me: () => ({ id: sock.user?.id, lid: sock.user?.lid }),
    async send(jid, text, quoted) {
      const out = await sock.sendMessage(jid, { text: `${config.replyPrefix}${text}` }, quoted ? { quoted } : undefined);
      if (out?.key?.id) sent.add(out.key.id);
      return out;
    },
    async sendFile(jid, buffer, fileName, mimetype, caption) {
      const out = await sock.sendMessage(jid, {
        document: buffer, mimetype, fileName,
        ...(caption ? { caption: `${config.replyPrefix}${caption}` } : {}),
      });
      if (out?.key?.id) sent.add(out.key.id);
      return out;
    },
    async media(msg) {
      const info = mediaInfo(msg);
      const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
      return { kind: info.kind, mimeType: info.mimeType, data: Buffer.from(buf).toString('base64') };
    },
    typing: (jid) => sock.sendPresenceUpdate('composing', jid).catch(() => {}),
  };

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const id = msg.key.id;
      if (!msg.message || sent.has(id) || seen.has(id)) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      seen.add(id);
      if (seen.size > 5000) seen.clear();
      onMessage(msg, api).catch((e) => console.error('Erro ao processar mensagem:', e));
    }
  });

  return api;
}
