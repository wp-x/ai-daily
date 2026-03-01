import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { RSS_FEEDS } from './lib/rss-list.mjs';
import { fetchAllFeeds } from './lib/feeds.mjs';
import { scoreArticles } from './lib/scoring.mjs';
import { summarizeArticles } from './lib/summarize.mjs';
import { generateHighlights } from './lib/highlights.mjs';
import { saveDigest, saveArticles, getDigest, getDigestList, setDigestStatus, setDigestHighlights, getStats, createShareToken, getDigestByShareToken, saveRssSources, getRssSources, saveTranslation, getTranslation, getTranslationMap, deleteTranslation, pruneTranslations } from './lib/db.mjs';
import { authMiddleware, isPasswordSet, setPassword, verifyPassword, verifySession, getClientIp, isLocked, getRemainingLockTime } from './lib/auth.mjs';
import { saveApiConfig, loadApiConfig, API_PRESETS } from './lib/config.mjs';
import { saveCookieStorage, loadCookieStorage, isCookieConfigured, generatePodcast, getPodcastTask, listPodcastTasks } from './lib/podcast.mjs';
import { createReadStream, statSync } from 'fs';
import { join as pathJoin } from 'path';
import { translateArticle, translateArticleStream, batchTranslateArticles } from './lib/translate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';

app.use(express.json());

// Lightweight in-memory rate limiter
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000; // 1 min window
const RATE_MAX_REQUESTS = 120; // max requests per window

function rateLimit(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    record = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, record);
  }
  record.count++;
  if (record.count > RATE_MAX_REQUESTS) {
    return res.status(429).json({ ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
  }
  next();
}
app.use(rateLimit);

// Cleanup stale rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of rateLimitMap) {
    if (now - r.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, 300_000);

if (SITE_PASSWORD && !isPasswordSet()) {
  setPassword(SITE_PASSWORD);
  console.log('[auth] Password set from SITE_PASSWORD env');
}

// Async route wrapper
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Health check (no auth)
app.get('/health', (req, res) => res.send('ok'));

// --- Public share routes (NO auth) ---
// Serve share page HTML
app.get('/share/:token', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'share.html'));
});

app.get('/api/share/:token', (req, res) => {
  const digest = getDigestByShareToken(req.params.token);
  if (!digest || !digest.articles) return res.status(404).json({ ok: false, error: 'not_found' });
  // Strip internal fields, return public data
  const { shareToken, ...publicData } = digest;
  res.json({ ok: true, data: publicData });
});

// Auth middleware (after public routes)
app.use(authMiddleware);

// --- Auth routes ---
app.get('/api/auth/status', (req, res) => {
  const needsAuth = isPasswordSet();
  const token = req.headers['x-auth-token'];
  const authenticated = token ? verifySession(token) : false;
  res.json({ ok: true, needsAuth, authenticated });
});

app.post('/api/auth/login', (req, res) => {
  const ip = getClientIp(req);
  if (isLocked(ip)) return res.status(429).json({ ok: false, error: 'locked', message: `尝试次数过多，请 ${getRemainingLockTime(ip)} 秒后重试` });
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ ok: false, error: 'missing_password' });
  const result = verifyPassword(password, ip);
  if (result.ok) return res.json({ ok: true, token: result.token });
  if (result.locked) return res.status(429).json({ ok: false, error: 'locked', message: `尝试次数过多，请 ${result.remaining} 秒后重试` });
  res.status(401).json({ ok: false, error: 'wrong_password', message: `密码错误，还剩 ${result.attemptsLeft} 次尝试` });
});

// --- Config routes ---
app.get('/api/config', (req, res) => {
  const config = loadApiConfig();
  if (!config) return res.json({ ok: true, data: null });
  const masked = { ...config };
  if (masked.apiKey) masked.apiKeyMasked = masked.apiKey.slice(0, 6) + '***' + masked.apiKey.slice(-4);
  delete masked.apiKey;
  res.json({ ok: true, data: masked });
});

app.post('/api/config', (req, res) => {
  const { preset, apiKey, baseURL, model, schedules } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: 'missing_api_key' });
  const config = { preset: preset || 'auto', apiKey, baseURL: baseURL || '', model: model || '', schedules: schedules || [] };
  saveApiConfig(config);
  setupSchedules(config);
  res.json({ ok: true, message: '配置已加密保存' });
});

app.get('/api/presets', (req, res) => res.json({ ok: true, data: API_PRESETS }));

// --- Test API connection ---
app.post('/api/test-connection', asyncHandler(async (req, res) => {
  const { preset, apiKey, baseURL, model } = req.body || {};
  if (!apiKey) return res.status(400).json({ ok: false, error: 'missing_api_key' });

  const apiOpts = {
    preset: preset === 'auto' ? undefined : preset,
    baseURL: baseURL || API_PRESETS[preset]?.baseURL || '',
    model: model || API_PRESETS[preset]?.defaultModel || '',
  };

  try {
    // Import callAI from ai-client
    const { callAI } = await import('./lib/ai-client.mjs');
    // Simple test prompt
    const result = await callAI('Hello, respond with "OK"', apiKey, apiOpts);
    if (result && result.length > 0) {
      res.json({ ok: true, message: 'Connection successful' });
    } else {
      res.json({ ok: false, error: 'Empty response from API' });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
}));

// --- Share ---
app.post('/api/digest/share', (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ ok: false, error: 'missing_date' });
  const token = createShareToken(date);
  if (!token) return res.status(404).json({ ok: false, error: 'digest_not_found' });
  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const shareURL = `${protocol}://${host}/share/${token}`;
  res.json({ ok: true, token, url: shareURL });
});

// --- RSS source management ---
app.get('/api/rss-sources', (req, res) => {
  const custom = getRssSources();
  res.json({ ok: true, data: { default: RSS_FEEDS, custom: custom || [] } });
});

app.post('/api/rss-sources', (req, res) => {
  const { sources } = req.body || {};
  if (!Array.isArray(sources)) return res.status(400).json({ ok: false, error: 'invalid_sources' });
  // Validate sources
  for (const s of sources) {
    if (!s.name || !s.xmlUrl) return res.status(400).json({ ok: false, error: 'invalid_source_format' });
  }
  saveRssSources(sources);
  res.json({ ok: true, message: 'RSS 源已保存' });
});

app.post('/api/rss-sources/test', asyncHandler(async (req, res) => {
  const { xmlUrl } = req.body || {};
  if (!xmlUrl) return res.status(400).json({ ok: false, error: 'missing_url' });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(xmlUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AI-Daily-Digest/1.0', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    clearTimeout(timeout);
    if (!response.ok) return res.json({ ok: false, error: `HTTP ${response.status}` });
    const xml = await response.text();
    if (xml.length < 100) return res.json({ ok: false, error: 'Response too short' });
    res.json({ ok: true, message: 'RSS 源可访问' });
  } catch (err) {
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
}));

// --- Per-channel scheduling ---
let scheduleTimers = [];

function setupSchedules(config) {
  // Clear all existing timers
  scheduleTimers.forEach(t => clearInterval(t));
  scheduleTimers = [];

  const schedules = config.schedules || [];
  if (!schedules.length) return;

  const activeSchedules = schedules.filter(s => s.enabled);
  if (!activeSchedules.length) return;

  console.log(`[schedule] Setting up ${activeSchedules.length} schedule(s)`);

  // Single timer checks all schedules every minute
  let lastTriggeredKey = '';
  const timer = setInterval(() => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const triggerKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}_${h * 60 + m}`;

    // Prevent duplicate triggers within the same minute (includes date to allow next-day runs)
    if (triggerKey === lastTriggeredKey) return;

    for (const sched of activeSchedules) {
      if (h === (sched.hour ?? 8) && m === (sched.minute ?? 0)) {
        if (generationState.running) {
          console.log('[schedule] Skipped: generation already running');
          break;
        }
        lastTriggeredKey = triggerKey;
        const cfg = loadApiConfig();
        if (!cfg?.apiKey) continue;

        const preset = sched.preset || cfg.preset || 'auto';
        const apiOpts = {
          preset: preset === 'auto' ? undefined : preset,
          baseURL: sched.baseURL || cfg.baseURL || API_PRESETS[preset]?.baseURL || '',
          model: sched.model || cfg.model || API_PRESETS[preset]?.defaultModel || '',
        };

        console.log(`[schedule] Triggering ${sched.label || sched.preset || 'default'} at ${now.toISOString()}`);
        runDigestGeneration(cfg.apiKey, apiOpts, sched.hours || 48, sched.topN || 15).catch(err => {
          console.error(`[schedule] Failed: ${err.message}`);
        });
        break;
      }
    }
  }, 60000);

  scheduleTimers.push(timer);
  activeSchedules.forEach(s => {
    console.log(`[schedule] ${s.label || s.preset || 'default'}: ${String(s.hour ?? 8).padStart(2, '0')}:${String(s.minute ?? 0).padStart(2, '0')} daily (${s.hours || 48}h, top ${s.topN || 15})`);
  });
}

// Restore schedules on startup
const savedConfig = loadApiConfig();
if (savedConfig) setupSchedules(savedConfig);

// Prune old translations on startup (keep 30 days)
setImmediate(() => {
  const pruned = pruneTranslations(30);
  if (pruned > 0) console.log(`[translate] Pruned ${pruned} expired translations`);
});

// Service Worker — inject build timestamp to bust stale caches on each deploy
const BUILD_ID = Date.now().toString(36);
const swTemplate = readFileSync(join(__dirname, 'public', 'sw.js'), 'utf-8');
const swContent  = swTemplate.replace('__BUILD__', BUILD_ID);
app.get('/sw.js', (req, res) => {
  res.set({ 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
  res.send(swContent);
});

// Static files with cache control
app.use(express.static(join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
}));

// --- SSE for real-time progress ---
const sseClients = new Set();

function broadcastState(state) {
  const data = JSON.stringify(state);
  for (const res of sseClients) {
    try { res.write(`data: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
}

function updateGenerationState(patch) {
  Object.assign(generationState, patch);
  broadcastState(generationState);
}

app.get('/api/status/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify(generationState)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// --- Digest routes ---
let generationState = { running: false, step: '', progress: '', startedAt: null };
let translateState  = { running: false, total: 0, done: 0, current: '' };

app.get('/api/digest/latest', (req, res) => {
  const digest = getDigest(null);
  if (!digest || !digest.articles) return res.json({ ok: false, error: 'no_digest' });
  res.json({ ok: true, data: digest });
});
app.get('/api/digest/:date', (req, res) => {
  const digest = getDigest(req.params.date);
  if (!digest) return res.json({ ok: false, error: 'not_found' });
  res.json({ ok: true, data: digest });
});
app.get('/api/digests', (req, res) => res.json({ ok: true, data: getDigestList(30) }));
app.get('/api/stats', (req, res) => res.json({ ok: true, data: getStats() }));

// ── Article translation ───────────────────────────────────────────
function getApiOpts() {
  const config = loadApiConfig();
  const preset = config.preset === 'auto' ? undefined : config.preset;
  return {
    preset,
    apiKey:  config.apiKey  || '',
    baseURL: config.baseURL || '',
    model:   config.model   || API_PRESETS[preset]?.defaultModel || '',
  };
}

// ── Pre-translate all articles after digest generation ────────────
async function preTranslateArticles(articles, apiOpts) {
  const BATCH = 5;
  const toProcess = articles.filter(a => (a.link || a.url));
  console.log(`[translate] Pre-translating ${toProcess.length} articles in batches of ${BATCH}...`);
  translateState = { running: true, total: toProcess.length, done: 0, current: '' };

  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch = toProcess.slice(i, i + BATCH);
    const batchItems = batch.map(a => ({
      url:   a.link || a.url,
      title: a.title || '',
      desc:  a.description || a.summary || '',
    }));

    const batchLabel = `[${i+1}-${Math.min(i+BATCH, toProcess.length)}/${toProcess.length}]`;
    console.log(`[translate] Batch ${batchLabel}`);

    try {
      await batchTranslateArticles(batchItems, apiOpts);
    } catch (e) {
      console.warn(`[translate] Batch failed, retrying one-by-one: ${e.message}`);
      // Fallback: translate individually if batch fails
      for (const item of batchItems) {
        if (getTranslation(item.url)) continue;
        try {
          await translateArticle(item.url, item.title, item.desc, apiOpts);
        } catch (e2) {
          console.warn(`[translate] Single failed (${item.url.slice(0,50)}): ${e2.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    translateState.done = Math.min(i + BATCH, toProcess.length);
    // 2s between batches
    if (i + BATCH < toProcess.length) await new Promise(r => setTimeout(r, 2000));
  }

  translateState = { running: false, total: toProcess.length, done: toProcess.length, current: '' };
  console.log(`[translate] Pre-translation complete`);
}

// Non-streaming fallback (kept for compatibility)
app.get('/api/article/translate', asyncHandler(async (req, res) => {
  const { url, title = '', desc = '' } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const opts = getApiOpts();
  if (!opts.apiKey) return res.status(400).json({ ok: false, error: '请先在设置中配置 API Key' });
  const result = await translateArticle(url, title, desc, opts);
  res.json(result);
}));

// Return cached translation status for a list of URLs (for frontend badge display)
app.post('/api/article/translations/status', (req, res) => {
  const { urls = [] } = req.body || {};
  const map = getTranslationMap(urls);
  const status = {};
  for (const [url, t] of Object.entries(map)) {
    status[url] = { ok: true, ready: true, url, titleZh: t.titleZh, summary: t.summary, content: t.content || '' };
  }
  res.json({ ok: true, data: status });
});

// Translation progress (background pre-translation status)
app.get('/api/translate/progress', (req, res) => {
  res.json({ ok: true, data: translateState });
});

// Force re-translate (clear cache for a URL, then re-translate)
app.post('/api/article/retranslate', asyncHandler(async (req, res) => {
  const { url, title = '', desc = '' } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const opts = getApiOpts();
  if (!opts.apiKey) return res.status(400).json({ ok: false, error: '请先配置 API Key' });
  deleteTranslation(url);
  const result = await translateArticle(url, title, desc, opts);
  res.json(result);
}));

// SSE streaming endpoint
app.get('/api/article/translate/stream', async (req, res) => {
  const { url, title = '', desc = '' } = req.query;
  if (!url) { res.status(400).end(); return; }
  const opts = getApiOpts();
  if (!opts.apiKey) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event:error\ndata:${JSON.stringify({ error: '请先在设置中配置 API Key' })}\n\n`);
    res.end(); return;
  }

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  res.flushHeaders?.();

  // Heartbeat to keep connection alive
  const hb = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => clearInterval(hb));

  try {
    for await (const event of translateArticleStream(
      decodeURIComponent(url), decodeURIComponent(title), decodeURIComponent(desc), opts
    )) {
      res.write(event);
    }
  } catch (e) {
    res.write(`event:error\ndata:${JSON.stringify({ error: e.message })}\n\n`);
  } finally {
    clearInterval(hb);
    res.end();
  }
});
app.get('/api/status', (req, res) => res.json({ ok: true, data: generationState }));

app.post('/api/digest/generate', asyncHandler(async (req, res) => {
  if (generationState.running) return res.json({ ok: false, error: 'already_running', message: '正在生成中' });
  const config = loadApiConfig();
  const apiKey = req.body?.apiKey || config?.apiKey || '';
  if (!apiKey) return res.json({ ok: false, error: 'no_api_key', message: '需要 API Key，请先在设置中配置' });
  const preset = req.body?.preset || config?.preset || 'auto';
  const baseURL = req.body?.baseURL || config?.baseURL || API_PRESETS[preset]?.baseURL || '';
  const model = req.body?.model || config?.model || API_PRESETS[preset]?.defaultModel || '';
  const hours = req.body?.hours || 48;
  const topN = req.body?.topN || 15;
  const apiOpts = { preset: preset === 'auto' ? undefined : preset, baseURL, model };
  res.json({ ok: true, message: '开始生成日报' });
  runDigestGeneration(apiKey, apiOpts, hours, topN).catch(err => {
    console.error('[digest] Generation failed:', err.message);
    updateGenerationState({ running: false, step: 'error', progress: err.message, startedAt: null });
  });
}));

async function runDigestGeneration(apiKey, apiOpts, hours, topN) {
  const dateStr = new Date().toISOString().slice(0, 10);
  updateGenerationState({ running: true, step: 'fetching', progress: '正在抓取 RSS 源...', startedAt: Date.now() });
  try {
    // Use custom RSS sources if available, otherwise use default
    const customSources = getRssSources();
    const sources = customSources && customSources.length > 0 ? customSources : RSS_FEEDS;

    console.log(`[digest] 开始生成日报 (${sources.length} 源, ${hours}h, top${topN})`);
    saveDigest(dateStr, { hours, status: 'generating', totalFeeds: sources.length });
    const { articles: allArticles, successCount } = await fetchAllFeeds(sources, (done, total, ok, fail) => {
      updateGenerationState({ progress: `抓取进度: ${done}/${total} 源 (${ok} 成功, ${fail} 失败)` });
    });
    console.log(`[feeds] 共抓取 ${allArticles.length} 篇文章 (${successCount} 源成功)`);
    if (allArticles.length === 0) throw new Error('没有抓取到任何文章');

    // Deduplicate by link URL
    const seen = new Set();
    const dedupedArticles = allArticles.filter(a => {
      const key = a.link?.replace(/\/+$/, '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dupCount = allArticles.length - dedupedArticles.length;
    if (dupCount > 0) console.log(`[digest] Deduped: ${allArticles.length} → ${dedupedArticles.length} (${dupCount} duplicates removed)`);

    updateGenerationState({ step: 'filtering', progress: '按时间过滤...' });
    const cutoff = new Date(Date.now() - hours * 3600000);
    const recent = dedupedArticles.filter(a => a.pubDate.getTime() > cutoff.getTime());
    if (recent.length === 0) throw new Error(`最近 ${hours} 小时内没有找到文章`);

    console.log(`[scoring] AI 评分中 (${recent.length} 篇)...`);
    updateGenerationState({ step: 'scoring', progress: `AI 评分中 (${recent.length} 篇)...` });
    const scores = await scoreArticles(recent, apiKey, apiOpts, (done, total) => {
      updateGenerationState({ progress: `AI 评分: ${done}/${total} 批次` });
    });

    const scored = recent.map((a, i) => {
      const s = scores.get(i) || { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [] };
      return { ...a, score: s.relevance + s.quality + s.timeliness, score_relevance: s.relevance, score_quality: s.quality, score_timeliness: s.timeliness, category: s.category, keywords: s.keywords };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topN);

    console.log(`[summarize] 生成摘要 (${top.length} 篇)...`);
    updateGenerationState({ step: 'summarizing', progress: `生成摘要 (${top.length} 篇)...` });
    const indexed = top.map((a, i) => ({ ...a, index: i }));
    const summaries = await summarizeArticles(indexed, apiKey, apiOpts, (done, total) => {
      updateGenerationState({ progress: `生成摘要: ${done}/${total} 批次` });
    });

    const final = top.map((a, i) => {
      const sm = summaries.get(i) || { titleZh: a.title, summary: a.description?.slice(0, 200) || '', reason: '' };
      return {
        title: a.title, title_zh: sm.titleZh, link: a.link, source_name: a.sourceName, source_url: a.sourceUrl,
        pub_date: a.pubDate?.toISOString?.() || '', description: a.description || '',
        summary: sm.summary, reason: sm.reason, category: a.category, keywords: a.keywords,
        score: a.score, score_relevance: a.score_relevance, score_quality: a.score_quality, score_timeliness: a.score_timeliness,
      };
    });

    console.log('[highlights] 生成今日看点...');
    updateGenerationState({ step: 'highlights', progress: '生成今日看点...' });
    const highlights = await generateHighlights(final.map(a => ({ ...a, titleZh: a.title_zh })), apiKey, apiOpts);

    const totalFeeds = sources.length;

    saveDigest(dateStr, {
      highlights, totalFeeds, successFeeds: successCount,
      totalArticles: allArticles.length, filteredArticles: recent.length, hours, status: 'done',
      total_feeds: totalFeeds, success_feeds: successCount,
      total_articles: allArticles.length, filtered_articles: recent.length,
    });
    saveArticles(dateStr, final);
    setDigestHighlights(dateStr, highlights);
    setDigestStatus(dateStr, 'done');
    updateGenerationState({ running: false, step: 'done', progress: `完成！精选 ${final.length} 篇`, startedAt: null });
    console.log(`[digest] Done: ${successCount} sources → ${allArticles.length} → ${recent.length} → ${final.length}`);

    // ── Background pre-translation (non-blocking) ─────────────────
    const preTransOpts = { ...getApiOpts(), apiKey };
    if (apiKey) setImmediate(() => preTranslateArticles(final, preTransOpts));
  } catch (err) {
    updateGenerationState({ running: false, step: 'error', progress: err.message, startedAt: null });
    try { setDigestStatus(dateStr, 'error'); } catch (_) {}
    throw err;
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[error]', err.message, err.stack);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ ok: false, error: 'internal_error', message: err.message || '服务器内部错误' });
  } else {
    res.status(500).send('Internal Server Error');
  }
});

// ── Podcast routes ─────────────────────────────────────────────────────

// GET /api/podcast/config — cookie status
app.get('/api/podcast/config', (req, res) => {
  const info = loadCookieStorage();
  res.json({ ok: true, configured: !!info, cookieCount: info?.cookieCount || 0 });
});

// POST /api/podcast/config — save cookie
app.post('/api/podcast/config', (req, res) => {
  try {
    const { storageJson } = req.body;
    if (!storageJson) return res.status(400).json({ ok: false, message: '请提供 storage_state.json 内容' });
    saveCookieStorage(typeof storageJson === 'string' ? storageJson : JSON.stringify(storageJson));
    res.json({ ok: true, message: 'Cookie 保存成功' });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

// POST /api/podcast/generate — start generation
app.post('/api/podcast/generate', asyncHandler(async (req, res) => {
  const { articles, style = 'deep-dive', lang = 'zh', instructions = '' } = req.body;
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ ok: false, message: '请选择至少一篇文章' });
  }
  if (!isCookieConfigured()) {
    return res.status(400).json({ ok: false, message: '未配置 Google Cookie，请先在设置中填写' });
  }
  const taskId = await generatePodcast({ articles, style, lang, instructions });
  res.json({ ok: true, taskId });
}));

// GET /api/podcast/task/:id — poll status
app.get('/api/podcast/task/:id', (req, res) => {
  const task = getPodcastTask(req.params.id);
  if (!task) return res.status(404).json({ ok: false, message: '任务不存在' });
  res.json({ ok: true, task });
});

// GET /api/podcast/tasks — list recent tasks
app.get('/api/podcast/tasks', (req, res) => {
  res.json({ ok: true, tasks: listPodcastTasks() });
});

// GET /api/podcast/download/:filename — serve MP3
app.get('/api/podcast/download/:filename', (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!filename.endsWith('.mp3')) return res.status(400).json({ ok: false, message: '无效文件名' });
  const filepath = pathJoin(dirname(fileURLToPath(import.meta.url)), 'data', 'podcasts', filename);
  try {
    const stat = statSync(filepath);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    createReadStream(filepath).pipe(res);
  } catch {
    res.status(404).json({ ok: false, message: '文件不存在' });
  }
});

// SPA fallback — also handle /share/:token on frontend
app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`[ai-daily-web] 🚀 http://localhost:${PORT}`);
  if (!isPasswordSet()) console.log('[ai-daily-web] ⚠️  No password set');
});
