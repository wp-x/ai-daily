import { createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const AUTH_FILE = join(DATA_DIR, 'auth.json');

mkdirSync(DATA_DIR, { recursive: true });

// Rate limiting: track failed attempts per IP
const failedAttempts = new Map(); // ip -> { count, lastAttempt, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 min lockout
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 min window
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days session

// Active sessions
const sessions = new Map(); // token -> { ip, createdAt }

function hashPassword(password, salt) {
  return createHash('sha256').update(salt + password).digest('hex');
}

function loadAuth() {
  if (!existsSync(AUTH_FILE)) return null;
  try { return JSON.parse(readFileSync(AUTH_FILE, 'utf-8')); } catch { return null; }
}

function saveAuth(data) {
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

export function isPasswordSet() {
  return loadAuth() !== null;
}

export function setPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  saveAuth({ salt, hash });
}

export function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

export function isLocked(ip) {
  const record = failedAttempts.get(ip);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    return true;
  }
  // Clean up expired locks
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    failedAttempts.delete(ip);
    return false;
  }
  return false;
}

export function getRemainingLockTime(ip) {
  const record = failedAttempts.get(ip);
  if (!record?.lockedUntil) return 0;
  return Math.max(0, Math.ceil((record.lockedUntil - Date.now()) / 1000));
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, lastAttempt: 0, lockedUntil: null };
  
  // Reset if outside window
  if (now - record.lastAttempt > ATTEMPT_WINDOW_MS) {
    record.count = 0;
  }
  
  record.count++;
  record.lastAttempt = now;
  
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCK_DURATION_MS;
  }
  
  failedAttempts.set(ip, record);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

export function verifyPassword(password, ip) {
  if (isLocked(ip)) return { ok: false, locked: true, remaining: getRemainingLockTime(ip) };
  
  const auth = loadAuth();
  if (!auth) return { ok: false, error: 'no_password' };
  
  const hash = hashPassword(password, auth.salt);
  if (hash === auth.hash) {
    clearFailedAttempts(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { ip, createdAt: Date.now() });
    return { ok: true, token };
  }
  
  recordFailedAttempt(ip);
  const record = failedAttempts.get(ip);
  return {
    ok: false,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - (record?.count || 0)),
    locked: isLocked(ip),
    remaining: getRemainingLockTime(ip),
  };
}

export function verifySession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function authMiddleware(req, res, next) {
  // Allow login endpoint
  if (req.path === '/api/auth/login' || req.path === '/api/auth/status') return next();
  // Allow static assets for login page
  if (!req.path.startsWith('/api/') && (req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.ico') || req.path.endsWith('.png'))) return next();
  
  // Check if password is set
  if (!isPasswordSet()) return next();
  
  // Check session token
  const token = req.headers['x-auth-token'] || req.query?.token;
  if (verifySession(token)) return next();
  
  // For API requests, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  
  // For page requests, serve the page (frontend handles auth state)
  next();
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
  for (const [ip, record] of failedAttempts) {
    if (record.lockedUntil && now > record.lockedUntil + ATTEMPT_WINDOW_MS) failedAttempts.delete(ip);
  }
}, 60000);
