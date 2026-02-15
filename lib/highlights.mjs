import { callAI } from './ai-client.mjs';

export async function generateHighlights(articles, apiKey, apiOpts) {
  const list = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.titleZh || a.title} — ${a.summary?.slice(0, 100) || ''}`
  ).join('\n');

  const prompt = `根据以下今日精选技术文章列表，写一段 3-5 句话的"今日看点"总结。
要求：提炼出今天技术圈的 2-3 个主要趋势或话题，不要逐篇列举，要做宏观归纳，风格简洁有力，像新闻导语。用中文回答。

文章列表：
${list}

直接返回纯文本总结，不要 JSON，不要 markdown 格式。`;

  try {
    return (await callAI(prompt, apiKey, apiOpts)).trim();
  } catch (e) {
    console.warn(`[highlights] failed: ${e.message}`);
    return '';
  }
}
