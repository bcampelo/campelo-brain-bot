import 'dotenv/config';

// Data sources do Notion que o bot usa. Cada uma vem do .env como NOTION_DS_<NOME>.
export const NOTION_DS = ['perfil', 'materias', 'projetos', 'livros', 'avaliacoes', 'tarefas', 'notas', 'diario', 'lancamentos', 'recompensas', 'ficha_treino', 'areas'];

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const jsonObj = (v) => { try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const bool = (v, def = false) => (v === undefined || v === '' ? def : /^(1|true|sim|yes)$/i.test(v));

export const config = {
  tz: process.env.TZ_NAME || 'America/Sao_Paulo',

  // Nome de quem usa o bot (aparece no prompt da IA). Opcional.
  ownerName: process.env.OWNER_NAME || '',
  // Instituição padrão de matéria nova. Vazio = a IA não assume nenhuma.
  institution: process.env.INSTITUICAO_PADRAO || '',
  // Opções do campo Área do Notion e qual delas é a do trabalho (clientes, renda).
  areas: list(process.env.AREAS || 'Faculdade,Trabalho,Dev,Pessoal'),
  workArea: process.env.AREA_TRABALHO || 'Trabalho',
  // Apelidos de matérias em JSON, ex: {"so":"Sistemas Operacionais"}. Opcional.
  materiaAlias: jsonObj(process.env.ALIAS_MATERIAS),
  // Coordenadas para o clima do bom dia. Sem as duas, o bom dia sai sem clima.
  climaLat: process.env.CLIMA_LAT || '',
  climaLon: process.env.CLIMA_LON || '',

  // "gemini" ou "claude". Sem PROVIDER, usa o que tiver chave.
  provider: (process.env.PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'claude' : 'gemini')).toLowerCase(),

  anthropicKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',

  geminiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  // Modelos reserva quando o principal está sobrecarregado.
  geminiFallbacks: list(process.env.GEMINI_FALLBACK || 'gemini-flash-latest,gemini-3.5-flash-lite'),

  notionToken: process.env.NOTION_TOKEN,
  notionIds: Object.fromEntries(NOTION_DS.map((k) => [k, process.env[`NOTION_DS_${k.toUpperCase()}`] || ''])),
  // Página da pessoa no database Perfil. Tudo que soma XP precisa estar ligado nela.
  notionPerfilId: process.env.NOTION_PERFIL_ID || '',

  // Quem pode falar com o bot. Números só com dígitos, com DDI (ex: 5511999998888).
  ownerNumbers: list(process.env.OWNER_NUMBERS).map((n) => n.replace(/\D/g, '')),
  // JIDs de chats liberados (grupos ou conversas). Descubra mandando /id.
  allowedChats: list(process.env.ALLOWED_CHATS),
  // true quando o bot roda no SEU número e você conversa com ele em "Mensagem para você mesmo" ou num grupo só seu.
  allowFromMe: bool(process.env.ALLOW_FROM_ME, false),

  // Vincular por código em vez de QR (número do WhatsApp que vai rodar o bot, só dígitos).
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),
  authDir: process.env.AUTH_DIR || './auth',

  // Marca "Acordei antes das 6:30" quando a primeira mensagem do dia chega antes desse horário.
  autoWakeUp: bool(process.env.AUTO_ACORDEI, true),
  wakeUpLimit: process.env.ACORDEI_LIMITE || '06:30',

  // Resumo diário automático. Vazio desliga. Formato HH:MM.
  dailySummaryTime: process.env.RESUMO_DIARIO || '06:45',
  dailySummaryChat: process.env.RESUMO_CHAT || '',
  // Bom dia com clima, sequências e cobrança (dados coletados em código). BRIEFING=false volta ao resumo simples da IA.
  briefing: bool(process.env.BRIEFING, true),

  // Fechamento do dia (pergunta "como foi o dia?"). Vazio desliga. Formato HH:MM.
  fechamentoHora: process.env.FECHAMENTO_HORA ?? '21:30',

  // Aviso antes de tarefas com horário (minutos). 0 desliga. LEMBRETE_CHAT vazio usa o mesmo destino do resumo diário.
  reminderMinutes: Number(process.env.LEMBRETE_MIN ?? 30),
  reminderChat: process.env.LEMBRETE_CHAT || '',

  replyPrefix: process.env.REPLY_PREFIX ?? '🤖 ',
};

export function assertConfig() {
  const missing = [];
  if (config.provider === 'claude' && !config.anthropicKey) missing.push('ANTHROPIC_API_KEY');
  if (config.provider === 'gemini' && !config.geminiKey) missing.push('GEMINI_API_KEY');
  if (!config.notionToken) missing.push('NOTION_TOKEN');
  for (const k of NOTION_DS) if (!config.notionIds[k]) missing.push(`NOTION_DS_${k.toUpperCase()}`);
  if (!config.notionPerfilId) missing.push('NOTION_PERFIL_ID');
  if (missing.length) {
    console.error(`Faltam variáveis no .env: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!config.ownerNumbers.length && !config.allowedChats.length && !config.allowFromMe) {
    console.warn('Nenhum OWNER_NUMBERS, ALLOWED_CHATS ou ALLOW_FROM_ME definido. O bot só vai responder ao comando /id.');
  }
}
