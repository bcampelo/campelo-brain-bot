import { AsyncLocalStorage } from 'node:async_hooks';
// Guarda o chat e o cliente do WhatsApp da mensagem em andamento, para ferramentas que enviam arquivos.
export const ctx = new AsyncLocalStorage();
