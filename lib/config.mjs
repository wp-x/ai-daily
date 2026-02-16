import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'api-config.enc.json');
const ENCRYPTION_KEY = process.env.CONFIG_SECRET || 'ai-daily-web-default-secret-2025';

mkdirSync(DATA_DIR, { recursive: true });

function deriveKey(secret) {
  return scryptSync(secret, 'ai-daily-web-salt', 32);
}

function encrypt(text) {
  const iv = randomBytes(16);
  const key = deriveKey(ENCRYPTION_KEY);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), encrypted, tag };
}

function decrypt(data) {
  const key = deriveKey(ENCRYPTION_KEY);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function saveApiConfig(config) {
  const plaintext = JSON.stringify(config);
  const encrypted = encrypt(plaintext);
  writeFileSync(CONFIG_FILE, JSON.stringify(encrypted));
}

export function loadApiConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    const plaintext = decrypt(data);
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

// Preset channels
export const API_PRESETS = {
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    type: 'gemini',
  },
  doubao: {
    name: '豆包 (Doubao)',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6-251015',
    type: 'openai',
  },
  custom: {
    name: '自定义 OpenAI 兼容',
    baseURL: '',
    defaultModel: '',
    type: 'openai',
  },
};
