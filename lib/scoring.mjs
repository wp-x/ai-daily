import { callAI, parseJson } from './ai-client.mjs';

const BATCH_SIZE = 10;
const MAX_CONCURRENT = 2;

function buildScoringPrompt(articles) {
  const list = articles.map(a => `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`).join('\n\n---\n\n');
  return `你是一个技术内容策展人，正在为一份面向技术爱好者的每日精选摘要筛选文章。

请对以下文章进行三个维度的评分（1-10 整数，10 分最高），并为每篇文章分配一个分类标签和提取 2-4 个关键词。

## 评分维度
### 1. 相关性 (relevance) - 对技术/编程/AI/互联网从业者的价值
### 2. 质量 (quality) - 文章本身的深度和写作质量
### 3. 时效性 (timeliness) - 当前是否值得阅读

## 分类标签
- ai-ml / security / engineering / tools / opinion / other

## 关键词提取
提取 2-4 个最能代表文章主题的关键词（英文）

## 待评分文章
${list}

请严格按 JSON 格式返回：
{"results":[{"index":0,"relevance":8,"quality":7,"timeliness":9,"category":"engineering","keywords":["Rust","compiler"]}]}`;
}

const VALID_CATS = new Set(['ai-ml', 'security', 'engineering', 'tools', 'opinion', 'other']);

export async function scoreArticles(articles, apiKey, apiOpts, onProgress) {
  const scores = new Map();
  const indexed = articles.map((a, i) => ({ index: i, title: a.title, description: a.description, sourceName: a.sourceName }));
  const batches = [];
  for (let i = 0; i < indexed.length; i += BATCH_SIZE) batches.push(indexed.slice(i, i + BATCH_SIZE));

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async batch => {
      try {
        const text = await callAI(buildScoringPrompt(batch), apiKey, apiOpts);
        const parsed = parseJson(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            const clamp = v => Math.min(10, Math.max(1, Math.round(v)));
            scores.set(r.index, {
              relevance: clamp(r.relevance), quality: clamp(r.quality), timeliness: clamp(r.timeliness),
              category: VALID_CATS.has(r.category) ? r.category : 'other',
              keywords: Array.isArray(r.keywords) ? r.keywords.slice(0, 4) : [],
            });
          }
        }
      } catch (e) {
        console.warn(`[scoring] batch failed: ${e.message}`);
        for (const item of batch) scores.set(item.index, { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [] });
      }
    }));
    if (onProgress) onProgress(Math.min(i + MAX_CONCURRENT, batches.length), batches.length);
  }
  return scores;
}
