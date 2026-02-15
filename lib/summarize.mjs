import { callAI, parseJson } from './ai-client.mjs';

const BATCH_SIZE = 10;
const MAX_CONCURRENT = 2;

function buildSummaryPrompt(articles) {
  const list = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${a.description.slice(0, 800)}`
  ).join('\n\n---\n\n');

  return `你是一个技术内容摘要专家。请为以下文章完成三件事：
1. **中文标题** (titleZh): 将英文标题翻译成自然的中文。
2. **摘要** (summary): 4-6 句话的结构化摘要。
3. **推荐理由** (reason): 1 句话说明"为什么值得读"。

请用中文撰写。摘要要求直接说重点，包含具体技术名词、数据、方案名称。

## 待摘要文章
${list}

请严格按 JSON 格式返回：
{"results":[{"index":0,"titleZh":"中文标题","summary":"摘要...","reason":"推荐理由..."}]}`;
}

export async function summarizeArticles(articles, apiKey, apiOpts, onProgress) {
  const summaries = new Map();
  const batches = [];
  for (let i = 0; i < articles.length; i += BATCH_SIZE) batches.push(articles.slice(i, i + BATCH_SIZE));

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const group = batches.slice(i, i + MAX_CONCURRENT);
    await Promise.all(group.map(async batch => {
      try {
        const text = await callAI(buildSummaryPrompt(batch), apiKey, apiOpts);
        const parsed = parseJson(text);
        if (parsed.results) {
          for (const r of parsed.results) {
            summaries.set(r.index, { titleZh: r.titleZh || '', summary: r.summary || '', reason: r.reason || '' });
          }
        }
      } catch (e) {
        console.warn(`[summarize] batch failed: ${e.message}`);
        for (const item of batch) summaries.set(item.index, { titleZh: item.title, summary: item.description?.slice(0, 200) || '', reason: '' });
      }
    }));
    if (onProgress) onProgress(Math.min(i + MAX_CONCURRENT, batches.length), batches.length);
  }
  return summaries;
}
