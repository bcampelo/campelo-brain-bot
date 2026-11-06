// Estado em arquivo JSON dentro de config.authDir (volume do Docker, fora do git).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(config.authDir, name), 'utf8')); } catch { return fallback; }
}

export function writeJson(name, data) {
  try {
    fs.mkdirSync(config.authDir, { recursive: true });
    fs.writeFileSync(path.join(config.authDir, name), JSON.stringify(data));
  } catch (e) { console.error(`[${name}] não salvou`, e.message); }
}
