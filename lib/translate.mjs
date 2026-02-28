import { parse } from 'node-html-parser';
import { callAI, callAIStream } from './ai-client.mjs';
import { saveTranslation, getTranslation } from './db.mjs';

const FETCH_TIMEOUT_MS = 12000;

// ── Content extraction ────────────────────────────────────────────
function extractContent(html) {
  try {
    const root = parse(html);
    for (const sel of [
      'script','style','nav','header','footer','.nav','.header','.footer',
      '.sidebar','.ad','.advertisement','.cookie','#cookie',
      '[class*="banner"]','[class*="popup"]','[class*="subscribe"]',
      '[class*="newsletter"]','noscript','iframe',
    ]) root.querySelectorAll(sel).forEach(n => n.remove());

    const candidates = [
      'article','[itemprop="articleBody"]','.post-content','.article-content',
      '.entry-content','.content-body','.post-body','.article-body',
      'main','.main-content','#content','.content',
    ];
    for (const sel of candidates) {
      const el = root.querySelector(sel);
      if (el) {
        const text = el.text.replace(/\s+/g, ' ').trim();
        if (text.length > 300) return text;
      }
    }
    return root.querySelector('body')?.text.replace(/\s+/g, ' ').trim() || '';
  } catch { return ''; }
}

// Smart truncation: keep intro + key middle sections
function smartTruncate(text, maxChars = 12000) {
  if (text.length <= maxChars) return text;
  // Keep first 65% + last 20% — intro + conclusion most important
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.floor(maxChars * 0.25);
  return text.slice(0, head) + '\n\n[…中间部分已省略…]\n\n' + text.slice(-tail);
}

// ── Fetch article content ─────────────────────────────────────────
async function fetchContent(url, fallbackDesc) {
  let raw = '';
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
    if (res.ok) raw = extractContent(await res.text());
  } catch (e) {
    console.warn(`[translate] fetch failed: ${e.message}`);
  }
  if (raw.length < 200 && fallbackDesc) raw = fallbackDesc;
  return smartTruncate(raw);
}

// ── Prompt (structured text, not JSON — works with streaming) ─────
function buildPrompt(title, content, url) {
  const isShort = content.length < 1500;
  return `你是专业科技内容编辑，将英文技术文章翻译成高质量中文。

翻译要求：
- 意译为主，根据中文语境重新表达，不逐字翻译
- 技术术语保留英文或加括号注明（如 LLM、RAG、fine-tuning）
- 正文使用 Markdown 格式：章节用 ## 标题，重点用 **加粗**，列表用 -，引用用 >
- 段落间空行，语气专业但不晦涩，像优质中文科技媒体文章

原文标题：${title}
原文来源：${url}
${isShort ? '（文章较短，请完整翻译）' : '（文章较长，请翻译核心内容，保留重要细节）'}

原文内容：
${content}

请严格按以下格式输出，不要输出任何其他内容：
TITLE_ZH:中文标题（一行）
SUMMARY_ZH:2-3句核心要点（一行）
---CONTENT---
正文翻译（段落间空行）`;
}

// ── Parse structured response ─────────────────────────────────────
function parseStructured(text) {
  const titleMatch  = text.match(/TITLE_ZH:(.+)/);
  const summaryMatch = text.match(/SUMMARY_ZH:(.+)/);
  const contentMatch = text.match(/---CONTENT---\n?([\s\S]*)/);
  return {
    titleZh: titleMatch?.[1]?.trim() || '',
    summary: summaryMatch?.[1]?.trim() || '',
    content: contentMatch?.[1]?.trim() || text,
  };
}

// ── Batch translate (background, uses RSS description) ───────────
function buildBatchPrompt(articles) {
  const list = articles.map((a, i) =>
    `[${i}] 标题: ${a.title}\n    来源: ${a.url}\n    摘要: ${(a.desc || '').slice(0, 400)}`
  ).join('\n\n');

  return `你是专业科技内容编辑，将以下${articles.length}篇英文技术文章翻译成高质量中文。

翻译要求：
- 意译为主，根据中文语境重新表达，不逐字翻译
- 技术术语保留英文或加括号注明（如 LLM、RAG、fine-tuning）
- 每篇给出：中文标题、2-3句核心摘要（基于提供的英文摘要扩写）
- content 字段填写对摘要的中文扩写（150-300字，不要编造原文没有的内容）

文章列表：
${list}

请严格按JSON格式返回，不要输出其他内容：
{"results":[{"index":0,"titleZh":"中文标题","summary":"摘要","content":"正文扩写"},{"index":1,...},...]}`;
}

export async function batchTranslateArticles(articles, apiOpts) {
  // articles: [{url, title, desc}]
  // Filter out already-cached ones
  const toTranslate = articles.filter(a => a.url && !getTranslation(a.url));
  if (!toTranslate.length) return;

  try {
    const raw = await callAI(buildBatchPrompt(toTranslate), apiOpts.apiKey, {
      preset: apiOpts.preset, baseURL: apiOpts.baseURL, model: apiOpts.model,
    });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const { results } = JSON.parse(jsonMatch[0]);
    for (const r of results) {
      const article = toTranslate[r.index];
      if (!article) continue;
      const out = { ok: true, titleZh: r.titleZh, summary: r.summary, content: r.content, url: article.url };
      saveTranslation(article.url, out);
    }
  } catch (e) {
    console.warn(`[translate] Batch failed: ${e.message}`);
    throw e;
  }
}

// ── Non-streaming translate (short articles / cache hit) ──────────
export async function translateArticle(url, title, fallbackDesc, apiOpts) {
  const cached = getTranslation(url);
  if (cached) return { ok: true, ...cached };

  const content = await fetchContent(url, fallbackDesc);
  if (!content) return { ok: false, error: '无法获取文章内容，该网站可能需要登录或不支持抓取' };

  try {
    const raw = await callAI(buildPrompt(title, content, url), apiOpts.apiKey, {
      preset: apiOpts.preset, baseURL: apiOpts.baseURL, model: apiOpts.model,
    });
    const parsed = parseStructured(raw);
    const out = { ok: true, ...parsed, url };
    saveTranslation(url, out);
    return out;
  } catch (e) {
    return { ok: false, error: `翻译失败：${e.message}` };
  }
}

// ── Streaming translate — yields SSE-ready event strings ──────────
export async function* translateArticleStream(url, title, fallbackDesc, apiOpts) {
  const dbCached = getTranslation(url);
  if (dbCached) {
    const cached = dbCached;
    yield `event:meta\ndata:${JSON.stringify({ titleZh: cached.titleZh, summary: cached.summary })}\n\n`;
    // Stream cached content in chunks for consistent UX
    const chunks = cached.content.match(/.{1,80}/gs) || [];
    for (const chunk of chunks) {
      yield `event:chunk\ndata:${JSON.stringify({ text: chunk })}\n\n`;
    }
    yield `event:done\ndata:{}\n\n`;
    return;
  }

  const content = await fetchContent(url, fallbackDesc);
  if (!content) {
    yield `event:error\ndata:${JSON.stringify({ error: '无法获取文章内容，该网站可能需要登录或不支持抓取' })}\n\n`;
    return;
  }

  // Determine if short (non-stream) or long (stream)
  const isShort = content.length < 1500;

  if (isShort) {
    // Short: non-streaming, faster
    yield `event:status\ndata:${JSON.stringify({ msg: '正在翻译…' })}\n\n`;
    try {
      const raw = await callAI(buildPrompt(title, content, url), apiOpts.apiKey, {
        preset: apiOpts.preset, baseURL: apiOpts.baseURL, model: apiOpts.model,
      });
      const parsed = parseStructured(raw);
      saveTranslation(url, { ok: true, ...parsed, url });
      yield `event:meta\ndata:${JSON.stringify({ titleZh: parsed.titleZh, summary: parsed.summary })}\n\n`;
      yield `event:chunk\ndata:${JSON.stringify({ text: parsed.content })}\n\n`;
      yield `event:done\ndata:{}\n\n`;
    } catch (e) {
      yield `event:error\ndata:${JSON.stringify({ error: e.message })}\n\n`;
    }
    return;
  }

  // Long: streaming
  yield `event:status\ndata:${JSON.stringify({ msg: '正在抓取并翻译，内容较长请稍候…' })}\n\n`;

  let fullText = '';
  let metaSent = false;
  let contentStarted = false;

  try {
    for await (const chunk of callAIStream(buildPrompt(title, content, url), apiOpts.apiKey, {
      preset: apiOpts.preset, baseURL: apiOpts.baseURL, model: apiOpts.model,
    })) {
      fullText += chunk;

      // Try to extract and send meta as soon as we have it
      if (!metaSent) {
        const titleMatch   = fullText.match(/TITLE_ZH:(.+)/);
        const summaryMatch = fullText.match(/SUMMARY_ZH:(.+)/);
        if (titleMatch && summaryMatch) {
          metaSent = true;
          yield `event:meta\ndata:${JSON.stringify({
            titleZh: titleMatch[1].trim(),
            summary: summaryMatch[1].trim(),
          })}\n\n`;
        }
        continue; // Don't stream header lines as content
      }

      // Once past ---CONTENT--- marker, stream chunks
      if (!contentStarted) {
        if (fullText.includes('---CONTENT---')) {
          contentStarted = true;
          // Send everything after the marker so far
          const afterMarker = fullText.split('---CONTENT---')[1] || '';
          if (afterMarker.trim()) {
            yield `event:chunk\ndata:${JSON.stringify({ text: afterMarker })}\n\n`;
          }
        }
        continue;
      }

      yield `event:chunk\ndata:${JSON.stringify({ text: chunk })}\n\n`;
    }

    // Cache full result
    const parsed = parseStructured(fullText);
    saveTranslation(url, { ok: true, ...parsed, url });
    yield `event:done\ndata:{}\n\n`;

  } catch (e) {
    yield `event:error\ndata:${JSON.stringify({ error: e.message })}\n\n`;
  }
}
