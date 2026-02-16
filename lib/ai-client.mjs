// Unified AI API client - supports Gemini, OpenAI, Doubao, and any OpenAI-compatible API

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 600000; // 600s timeout
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

async function callAI(prompt, apiKey, options = {}) {
  const { preset, baseURL, model } = options;

  // Determine API type from preset or auto-detect
  if (preset === 'gemini' || (!preset && apiKey.startsWith('AIza'))) {
    const m = model || 'gemini-2.0-flash';
    return callWithRetry(() => callGemini(prompt, apiKey, m));
  } else {
    // OpenAI-compatible (OpenAI, SiliconFlow, Doubao, custom)
    let url = baseURL || 'https://api.openai.com/v1';
    let mdl = model || 'gpt-4o-mini';

    if (preset === 'doubao') {
      url = baseURL || 'https://ark.cn-beijing.volces.com/api/v3';
      mdl = model || 'doubao-seed-1-6-251015';
    } else if (preset === 'openai') {
      url = baseURL || 'https://api.openai.com/v1';
      mdl = model || 'gpt-4o-mini';
    }

    return callWithRetry(() => callOpenAI(prompt, apiKey, url, mdl));
  }
}

async function callWithRetry(fn) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err.message.includes('timeout') ||
                          err.message.includes('fetch failed') ||
                          err.message.includes('ECONNRESET') ||
                          err.message.includes('ECONNREFUSED') ||
                          err.message.includes('ETIMEDOUT') ||
                          err.message.includes('ENOTFOUND') ||
                          err.message.includes('429') ||
                          err.message.includes('500') ||
                          err.message.includes('502') ||
                          err.message.includes('503');

      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw err;
      }

      const delay = RETRY_DELAYS[attempt];
      console.warn(`[ai-client] Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function callGemini(prompt, apiKey, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, topP: 0.8, topK: 40 },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Gemini API timeout after 60s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(prompt, apiKey, baseURL, model) {
  const url = baseURL.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`API error (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('API timeout after 60s');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(t);
}

export { callAI, parseJson };
