// Article fetcher + translator
import { parse } from 'node-html-parser';
import { callAI } from './ai-client.mjs';

const FETCH_TIMEOUT_MS = 12000;
const cache = new Map(); // url → { html, translatedAt }

// ── Content extraction ────────────────────────────────────────────
function extractContent(html, url) {
  try {
    const root = parse(html);

    // Remove noise
    for (const sel of ['script','style','nav','header','footer',
      '.nav','.header','.footer','.sidebar','.ad','.advertisement',
      '.cookie','#cookie','[class*="banner"]','[class*="popup"]',
      '[class*="subscribe"]','[class*="newsletter"]','noscript','iframe']) {
      root.querySelectorAll(sel).forEach(n => n.remove());
    }

    // Try common article containers in priority order
    const candidates = [
      'article', '[itemprop="articleBody"]', '.post-content',
      '.article-content', '.entry-content', '.content-body',
      '.post-body', '.article-body', 'main', '.main-content',
      '#content', '.content',
    ];

    for (const sel of candidates) {
      const el = root.querySelector(sel);
      if (el) {
        const text = el.text.replace(/\s+/g, ' ').trim();
        if (text.length > 300) return text.slice(0, 8000);
      }
    }

    // Fallback: body text
    const body = root.querySelector('body');
    if (body) return body.text.replace(/\s+/g, ' ').trim().slice(0, 8000);
  } catch {}
  return '';
}

// ── Translation prompt ────────────────────────────────────────────
function buildTranslatePrompt(title, content, url) {
  return `你是一位专业的科技内容编辑，擅长将英文技术文章翻译成高质量的中文。

## 翻译要求
- **意译为主**：不要逐字翻译，要根据中文语境重新表达，让中文读者自然读懂
- **保留专业术语**：技术名词（如 LLM、RAG、fine-tuning）保留英文或加括号注明
- **段落结构**：保持原文的段落逻辑，每段之间空行
- **标题翻译**：给出一个吸引人的中文标题
- **语气**：专业但不晦涩，像一篇优质的中文科技媒体文章

## 原文信息
标题：${title}
来源：${url}

## 原文内容
${content}

## 输出格式（严格 JSON）
{
  "titleZh": "中文标题",
  "summary": "2-3句话的核心要点（中文）",
  "content": "完整中文翻译正文，段落之间用\\n\\n分隔"
}`;
}

// ── Main export ───────────────────────────────────────────────────
export async function translateArticle(url, title, fallbackDesc, apiOpts) {
  const cacheKey = url;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  let rawContent = '';

  // 1. Try fetching full article
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Daily-Reader/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      const html = await res.text();
      rawContent = extractContent(html, url);
    }
  } catch (e) {
    console.warn(`[translate] fetch failed for ${url}: ${e.message}`);
  }

  // 2. Fallback to RSS description
  if (rawContent.length < 200 && fallbackDesc) {
    rawContent = fallbackDesc;
  }

  if (!rawContent) {
    return { ok: false, error: '无法获取文章内容，该网站可能需要登录或不支持抓取' };
  }

  // 3. Translate
  try {
    const prompt = buildTranslatePrompt(title, rawContent, url);
    const raw = await callAI(prompt, apiOpts.apiKey, {
      preset: apiOpts.preset,
      baseURL: apiOpts.baseURL,
      model: apiOpts.model,
    });

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const result = JSON.parse(jsonMatch[0]);

    const out = { ok: true, titleZh: result.titleZh, summary: result.summary, content: result.content, url };
    cache.set(cacheKey, out);
    return out;
  } catch (e) {
    console.error(`[translate] AI error: ${e.message}`);
    return { ok: false, error: `翻译失败：${e.message}` };
  }
}
