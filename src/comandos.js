// Comandos tratados sem passar pela IA. Devolve o texto da resposta, ou null se a mensagem não é um comando.
import { desfazer } from './historico.js';
import { escreverDiario, lerDiario } from './tools.js';
import { adiar } from './lembretes.js';

export async function tratar({ chat, text, quotedId }) {
  const d = text.match(/^\/desfazer(?:\s+(\d+))?\s*$/i);
  if (d) return desfazer(chat, Math.min(Math.max(Number(d[1] || 1), 1), 20));

  const dia = text.match(/^\/di[aá]rio(?:\s+([\s\S]*))?$/i);
  if (dia) {
    const texto = (dia[1] || '').trim();
    if (texto) {
      await escreverDiario(texto);
      return 'Anotado no diário de hoje.';
    }
    const hoje = await lerDiario();
    return hoje ? `Diário de hoje:\n${hoje}` : 'Nada escrito no diário hoje.';
  }
  return adiar(text, quotedId); // "+15", "adiar 30", "amanhã" respondendo a um aviso
}

// Áudio que começa com "diário" vai direto para o diário. Devolve o resto da frase, ou null.
export const textoDiarioDeAudio = (transcricao) => transcricao.match(/^\s*di[aá]rio\b[\s:,.\-–]*(\S[\s\S]*)$/i)?.[1].trim() ?? null;

export async function diarioPorAudio(chat, transcricao) {
  const resto = textoDiarioDeAudio(transcricao);
  return resto ? `🎙️ ${await tratar({ chat, text: `/diario ${resto}` })}` : null;
}
