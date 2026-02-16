let authToken = localStorage.getItem('auth_token') || '';
let currentDigest = null;
let currentFilter = 'all';
let searchQuery = '';
let selectedPreset = 'gemini';

const CATEGORY_META = {
  'ai-ml': { emoji: '🤖', label: 'AI / ML' }, 'security': { emoji: '🔒', label: '安全' },
  'engineering': { emoji: '⚙️', label: '工程' }, 'tools': { emoji: '🛠', label: '工具' },
  'opinion': { emoji: '💡', label: '观点' }, 'other': { emoji: '📝', label: '其他' },
};

// Convert score (0-30) to star rating HTML
function renderStars(score) {
  const rating = Math.round((score / 30) * 10) / 2; // Convert to 0-5 scale, round to 0.5
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 !== 0;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  let html = '<span class="inline-flex items-center gap-0.5" title="' + score + '/30">';
  for (let i = 0; i < fullStars; i++) html += '<svg class="w-3.5 h-3.5 text-warm-500 fill-current" viewBox="0 0 20 20"><path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  if (hasHalf) html += '<svg class="w-3.5 h-3.5 text-warm-500" viewBox="0 0 20 20"><defs><linearGradient id="half"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path fill="url(#half)" d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  for (let i = 0; i < emptyStars; i++) html += '<svg class="w-3.5 h-3.5 text-sand-300 dark:text-ink-700" viewBox="0 0 20 20"><path fill="currentColor" d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/></svg>';
  html += '</span>';
  return html;
}

const PRESET_HINTS = {
  gemini: '免费获取: aistudio.google.com/apikey',
  doubao: '获取: console.volcengine.com/ark',
  custom: '填入你的 OpenAI 兼容服务 Key',
};

const API_PRESETS = {
  gemini: { name: 'Google Gemini' },
  doubao: { name: '豆包 Doubao' },
  custom: { name: '自定义' },
};

// --- Theme ---
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.classList.add('dark');
  else if (saved === 'light') document.documentElement.classList.remove('dark');
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
}
initTheme();

document.getElementById('themeToggle').addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
});

// --- Auth ---
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status', { headers: { 'X-Auth-Token': authToken } });
    const data = await res.json();
    if (data.needsAuth && !data.authenticated) { showLogin(); return false; }
    showApp(); return true;
  } catch { showApp(); return true; }
}
function showLogin() { document.getElementById('loginScreen').classList.remove('hidden'); document.getElementById('mainApp').classList.add('hidden'); document.getElementById('loginPassword').focus(); }
function showApp() { document.getElementById('loginScreen').classList.add('hidden'); document.getElementById('mainApp').classList.remove('hidden'); }

document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const pw = document.getElementById('loginPassword').value;
  if (!pw) return;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const data = await res.json();
    if (data.ok) { authToken = data.token; localStorage.setItem('auth_token', authToken); showApp(); loadLatest(); loadDigestList(); }
    else { errEl.textContent = data.message || '密码错误'; errEl.classList.remove('hidden'); document.getElementById('loginPassword').value = ''; }
  } catch { errEl.textContent = '网络错误'; errEl.classList.remove('hidden'); }
}

function apiFetch(url, opts = {}) { opts.headers = { ...opts.headers, 'X-Auth-Token': authToken }; return fetch(url, opts); }

// --- Time ---
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 60) return `${m}分钟前`; if (h < 24) return `${h}小时前`; if (d < 7) return `${d}天前`;
  return dateStr.slice(0, 10);
}

// --- Render ---
function renderDigest(digest) {
  currentDigest = digest;
  ['highlightsSection','statsSection','filterSection','top3Section','divider','articleSection'].forEach(id => document.getElementById(id).classList.remove('hidden'));
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('digestDate').textContent = digest.date;
  document.getElementById('highlightsText').textContent = digest.highlights || '暂无今日看点';
  document.getElementById('statSources').textContent = `${digest.success_feeds||digest.successFeeds||0}/${digest.total_feeds||digest.totalFeeds||90}`;
  document.getElementById('statTotal').textContent = digest.total_articles||digest.totalArticles||'-';
  document.getElementById('statFiltered').textContent = digest.filtered_articles||digest.filteredArticles||'-';
  document.getElementById('statSelected').textContent = digest.articles?.length||0;
  renderArticles();
}

function renderArticles() {
  if (!currentDigest?.articles) return;
  let articles = [...currentDigest.articles];
  if (currentFilter !== 'all') articles = articles.filter(a => a.category === currentFilter);
  if (searchQuery) { const q = searchQuery.toLowerCase(); articles = articles.filter(a => (a.title_zh||'').toLowerCase().includes(q)||(a.title||'').toLowerCase().includes(q)||(a.summary||'').toLowerCase().includes(q)||(a.source_name||'').toLowerCase().includes(q)||(a.keywords||[]).some(k=>k.toLowerCase().includes(q))); }

  const top3 = articles.slice(0, 3);
  const ranks = ['gold','silver','bronze'];
  document.getElementById('top3Grid').innerHTML = top3.map((a, i) => `
    <div class="top-card ${ranks[i]}">
      <div class="flex items-center gap-3 mb-4">
        <span class="medal ${ranks[i]}">${i+1}</span>
        <span class="category-badge" data-cat="${a.category}">${CATEGORY_META[a.category]?.label||a.category}</span>
        <span class="ml-auto">${renderStars(a.score)}</span>
      </div>
      <h3 class="text-lg sm:text-xl font-semibold leading-tight mb-3">
        <a href="${a.link}" target="_blank" rel="noopener" class="hover:text-warm-600 dark:hover:text-warm-400 transition">${a.title_zh||a.title}</a>
      </h3>
      <p class="text-xs text-sand-400 mb-4 line-clamp-1">${a.title}</p>
      <p class="text-sm sm:text-base leading-relaxed text-sand-600 dark:text-sand-400 mb-4 line-clamp-4">${a.summary||''}</p>
      ${a.reason?`<p class="text-xs text-warm-600 dark:text-warm-400 mb-4 italic leading-relaxed">"${a.reason}"</p>`:''}
      <div class="flex items-center gap-2 text-xs text-sand-400 pt-3 border-t border-sand-100 dark:border-ink-800">
        <span class="font-medium truncate">${a.source_name}</span>
        <span class="opacity-30 shrink-0">·</span>
        <span class="shrink-0 whitespace-nowrap">${timeAgo(a.pub_date)}</span>
      </div>
      ${(a.keywords||[]).length?`<div class="flex flex-wrap gap-2 mt-4">${a.keywords.map(k=>`<span class="keyword-tag">${k}</span>`).join('')}</div>`:''}
    </div>`).join('');

  const rest = articles.slice(3);
  document.getElementById('articleList').innerHTML = rest.map((a, i) => `
    <div class="article-card group">
      <div class="flex items-start gap-4 sm:gap-6">
        <span class="text-lg sm:text-xl font-light text-sand-200 dark:text-ink-800 mt-1 w-8 text-right shrink-0">${i + 4}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <span class="category-badge" data-cat="${a.category}">${CATEGORY_META[a.category]?.label||a.category}</span>
            ${renderStars(a.score)}
          </div>
          <h3 class="article-title group-hover:text-warm-600 dark:group-hover:text-warm-400 transition">
            <a href="${a.link}" target="_blank" rel="noopener" class="hover:underline">${a.title_zh||a.title}</a>
          </h3>
          <p class="text-xs text-sand-400 mb-3 line-clamp-1">${a.title}</p>
          <p class="article-summary line-clamp-3">${a.summary||''}</p>
          <div class="flex items-center gap-2 article-meta mt-4">
            <span class="font-medium truncate">${a.source_name}</span>
            <span class="opacity-30 shrink-0">·</span>
            <span class="shrink-0 whitespace-nowrap">${timeAgo(a.pub_date)}</span>
          </div>
          ${(a.keywords||[]).length?`<div class="flex flex-wrap gap-2 mt-4">${a.keywords.map(k=>`<span class="keyword-tag">${k}</span>`).join('')}</div>`:''}
        </div>
      </div>
    </div>`).join('');

  document.getElementById('top3Section').classList.toggle('hidden', top3.length === 0);
  document.getElementById('divider').classList.toggle('hidden', rest.length === 0);
  document.getElementById('articleSection').classList.toggle('hidden', rest.length === 0);
}

// --- Filters ---
document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); currentFilter = btn.dataset.cat; renderArticles();
}));
let searchTimer = null;
document.getElementById('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchQuery = e.target.value; renderArticles(); }, 300);
});

// --- Share ---
document.getElementById('shareBtn').addEventListener('click', async () => {
  if (!currentDigest?.date) return;
  try {
    const res = await apiFetch('/api/digest/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: currentDigest.date }),
    });
    const data = await res.json();
    if (data.ok) {
      const url = data.url;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert(`分享链接已复制！\n\n${url}\n\n对方无需登录即可查看`);
      } else {
        prompt('分享链接（对方无需登录）：', url);
      }
    } else { alert('生成分享链接失败'); }
  } catch { alert('网络错误'); }
});

// --- Share page detection ---
async function checkSharePage() {
  const path = window.location.pathname;
  const match = path.match(/^\/share\/([a-f0-9]+)$/);
  if (!match) return false;
  // This is a share page — load public data, no auth needed
  try {
    const res = await fetch(`/api/share/${match[1]}`);
    const data = await res.json();
    if (data.ok) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('mainApp').classList.remove('hidden');
      // Hide all admin controls in share mode
      document.getElementById('generateBtn').classList.add('hidden');
      document.getElementById('settingsBtn').classList.add('hidden');
      document.getElementById('shareBtn').classList.add('hidden');
      document.getElementById('themeToggle').classList.add('hidden');
      document.getElementById('dateSelect').parentElement.classList.add('hidden'); // Hide date selector row
      renderDigest(data.data);
      return true;
    }
  } catch {}
  return false;
}

// --- Settings: per-channel scheduling ---
const settingsModal = document.getElementById('settingsModal');

// Tab switching
document.querySelectorAll('.settings-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('apiTab').classList.toggle('hidden', tab !== 'api');
    document.getElementById('rssTab').classList.toggle('hidden', tab !== 'rss');
    if (tab === 'rss') loadRssSources();
  });
});

// RSS source management
let rssSources = [];

async function loadRssSources() {
  try {
    const res = await apiFetch('/api/rss-sources');
    const data = await res.json();
    if (data.ok) {
      rssSources = data.data.custom && data.data.custom.length > 0 ? data.data.custom : data.data.default;
      renderRssList();
    }
  } catch {}
}

function renderRssList() {
  const list = document.getElementById('rssList');
  list.innerHTML = rssSources.map((s, i) => `
    <div class="flex items-center gap-2 p-3 hover:bg-sand-50 dark:hover:bg-ink-950 transition">
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate">${s.name}</div>
        <div class="text-[10px] text-sand-400 truncate">${s.xmlUrl}</div>
      </div>
      <button class="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition" onclick="removeRss(${i})">删除</button>
    </div>
  `).join('');
}

window.removeRss = (index) => {
  rssSources.splice(index, 1);
  renderRssList();
  saveRssSources();
};

async function saveRssSources() {
  try {
    await apiFetch('/api/rss-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: rssSources }),
    });
  } catch {}
}

document.getElementById('testRssBtn').addEventListener('click', async () => {
  const url = document.getElementById('rssUrl').value.trim();
  const resultEl = document.getElementById('rssTestResult');
  const btn = document.getElementById('testRssBtn');
  if (!url) return;
  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.textContent = '正在测试...';
  resultEl.className = 'text-[10px] text-sand-500';
  resultEl.classList.remove('hidden');
  try {
    const res = await apiFetch('/api/rss-sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xmlUrl: url }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = '✅ RSS 源可访问';
      resultEl.className = 'text-[10px] text-green-600 dark:text-green-400';
    } else {
      resultEl.textContent = `❌ 失败: ${data.error}`;
      resultEl.className = 'text-[10px] text-red-500';
    }
  } catch {
    resultEl.textContent = '❌ 网络错误';
    resultEl.className = 'text-[10px] text-red-500';
  } finally {
    btn.disabled = false;
    btn.textContent = '测试';
  }
});

document.getElementById('addRssBtn').addEventListener('click', () => {
  const name = document.getElementById('rssName').value.trim();
  const url = document.getElementById('rssUrl').value.trim();
  if (!name || !url) return;
  rssSources.push({ name, xmlUrl: url, htmlUrl: url.replace(/\/feed.*$/, '') });
  renderRssList();
  saveRssSources();
  document.getElementById('rssName').value = '';
  document.getElementById('rssUrl').value = '';
  document.getElementById('rssTestResult').classList.add('hidden');
});

document.getElementById('resetRssBtn').addEventListener('click', async () => {
  if (!confirm('确定要恢复默认 RSS 源吗？这将删除所有自定义源。')) return;
  try {
    await apiFetch('/api/rss-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: [] }),
    });
    loadRssSources();
  } catch {}
});

document.getElementById('settingsBtn').addEventListener('click', async () => {
  settingsModal.classList.remove('hidden');
  // Load saved config
  try {
    const res = await apiFetch('/api/config');
    const data = await res.json();
    if (data.ok && data.data) {
      const c = data.data;
      selectPreset(c.preset || 'gemini');
      if (c.apiKeyMasked) document.getElementById('cfgApiKey').placeholder = c.apiKeyMasked;
      if (c.baseURL) document.getElementById('cfgBaseURL').value = c.baseURL;
      if (c.model) document.getElementById('cfgModel').value = c.model;
      if (c.schedules?.length) {
        const s = c.schedules[0];
        document.getElementById('cfgScheduleEnabled').checked = s.enabled;
        toggleScheduleFields(s.enabled);
        if (s.hour !== undefined) document.getElementById('cfgScheduleHour').value = s.hour;
        if (s.hours) document.getElementById('cfgScheduleHours').value = s.hours;
        if (s.topN) document.getElementById('cfgScheduleTopN').value = s.topN;
      }
    }
  } catch {}
});
document.getElementById('settingsCancel').addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });

function selectPreset(preset) {
  selectedPreset = preset;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
  document.getElementById('cfgApiKeyHint').textContent = PRESET_HINTS[preset] || '';
  document.getElementById('customFields').classList.toggle('hidden', preset !== 'custom' && preset !== 'doubao');
  // Pre-fill base URL for doubao
  if (preset === 'doubao') {
    const base = document.getElementById('cfgBaseURL');
    const model = document.getElementById('cfgModel');
    if (!base.value) base.value = 'https://ark.cn-beijing.volces.com/api/v3';
    if (!model.value) model.value = 'doubao-seed-1-6-251015';
    document.getElementById('customFields').classList.remove('hidden');
  }
}

document.querySelectorAll('.preset-btn').forEach(btn => btn.addEventListener('click', () => selectPreset(btn.dataset.preset)));

// Test API connection
document.getElementById('testApiBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('cfgApiKey').value.trim();
  const baseURL = document.getElementById('cfgBaseURL')?.value?.trim() || '';
  const model = document.getElementById('cfgModel')?.value?.trim() || '';
  const resultEl = document.getElementById('testResult');
  const btn = document.getElementById('testApiBtn');

  if (!apiKey) {
    resultEl.textContent = '请先输入 API Key';
    resultEl.className = 'text-[10px] mt-1 text-red-500';
    resultEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '测试中...';
  resultEl.textContent = '正在测试连接...';
  resultEl.className = 'text-[10px] mt-1 text-sand-500';
  resultEl.classList.remove('hidden');

  try {
    const res = await apiFetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: selectedPreset, apiKey, baseURL, model }),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = '✅ 连接成功！API Key 可用';
      resultEl.className = 'text-[10px] mt-1 text-green-600 dark:text-green-400';
    } else {
      resultEl.textContent = `❌ 连接失败: ${data.error || '未知错误'}`;
      resultEl.className = 'text-[10px] mt-1 text-red-500';
    }
  } catch (err) {
    resultEl.textContent = '❌ 网络错误';
    resultEl.className = 'text-[10px] mt-1 text-red-500';
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
});

function toggleScheduleFields(enabled) {
  document.getElementById('scheduleFields').classList.toggle('hidden', !enabled);
}
document.getElementById('cfgScheduleEnabled').addEventListener('change', e => toggleScheduleFields(e.target.checked));

document.getElementById('settingsSave').addEventListener('click', async () => {
  const apiKey = document.getElementById('cfgApiKey').value.trim();
  const baseURL = document.getElementById('cfgBaseURL')?.value?.trim() || '';
  const model = document.getElementById('cfgModel')?.value?.trim() || '';
  const scheduleEnabled = document.getElementById('cfgScheduleEnabled').checked;

  // Build schedule for current preset
  const schedules = scheduleEnabled ? [{
    enabled: true,
    preset: selectedPreset,
    label: API_PRESETS[selectedPreset]?.name || selectedPreset,
    hour: parseInt(document.getElementById('cfgScheduleHour').value) || 8,
    minute: 0,
    hours: parseInt(document.getElementById('cfgScheduleHours').value) || 48,
    topN: parseInt(document.getElementById('cfgScheduleTopN').value) || 15,
    baseURL: selectedPreset === 'custom' || selectedPreset === 'doubao' ? baseURL : '',
    model: selectedPreset === 'custom' || selectedPreset === 'doubao' ? model : '',
  }] : [];

  if (!apiKey) {
    const statusEl = document.getElementById('cfgStatus');
    statusEl.textContent = '请输入 API Key';
    statusEl.className = 'text-xs text-center text-red-500';
    statusEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await apiFetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: selectedPreset, apiKey, baseURL, model, schedules }),
    });
    const data = await res.json();
    const statusEl = document.getElementById('cfgStatus');
    if (data.ok) {
      statusEl.textContent = '✅ 配置已加密保存到服务器';
      statusEl.className = 'text-xs text-center text-green-600 dark:text-green-400';
      statusEl.classList.remove('hidden');
      setTimeout(() => { settingsModal.classList.add('hidden'); statusEl.classList.add('hidden'); }, 1500);
    } else {
      statusEl.textContent = data.message || '保存失败';
      statusEl.className = 'text-xs text-center text-red-500';
      statusEl.classList.remove('hidden');
    }
  } catch { alert('网络错误'); }
});

// --- Generate Modal ---
const genModal = document.getElementById('generateModal');
document.getElementById('generateBtn').addEventListener('click', async () => {
  // Check if config exists
  try {
    const res = await apiFetch('/api/config');
    const data = await res.json();
    if (data.ok && data.data?.apiKeyMasked) {
      document.getElementById('genConfigInfo').textContent = `使用已保存的配置 (${data.data.preset || 'auto'}: ${data.data.apiKeyMasked})`;
    } else {
      document.getElementById('genConfigInfo').innerHTML = '⚠️ 尚未配置 API Key，请先点击 <b>设置</b> 按钮配置';
    }
  } catch {}
  genModal.classList.remove('hidden');
});
document.getElementById('genCancel').addEventListener('click', () => genModal.classList.add('hidden'));
genModal.addEventListener('click', e => { if (e.target === genModal) genModal.classList.add('hidden'); });

document.getElementById('genConfirm').addEventListener('click', async () => {
  const hours = parseInt(document.getElementById('genHours').value);
  const topN = parseInt(document.getElementById('genTopN').value);
  genModal.classList.add('hidden');
  const res = await apiFetch('/api/digest/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours, topN }),
  });
  const data = await res.json();
  if (!data.ok) { alert(data.message || '生成失败'); return; }
  watchStatus();
});

let statusEventSource = null;
function watchStatus() {
  const banner = document.getElementById('statusBanner');
  const text = document.getElementById('statusText');
  banner.classList.remove('hidden');
  if (statusEventSource) statusEventSource.close();
  const sseUrl = authToken ? `/api/status/stream?token=${authToken}` : '/api/status/stream';
  statusEventSource = new EventSource(sseUrl);
  statusEventSource.onmessage = (e) => {
    try {
      const state = JSON.parse(e.data);
      text.textContent = state.progress || state.step;
      if (!state.running) {
        statusEventSource.close();
        statusEventSource = null;
        if (state.step === 'done') { banner.classList.add('hidden'); loadLatest(); }
        else if (state.step === 'error') { text.textContent = `生成失败: ${state.progress}`; setTimeout(() => banner.classList.add('hidden'), 5000); }
      }
    } catch {}
  };
  statusEventSource.onerror = () => {
    statusEventSource.close();
    statusEventSource = null;
    text.textContent = '连接中断，刷新页面重试';
    setTimeout(() => banner.classList.add('hidden'), 3000);
  };
}

// --- Load ---
async function loadDigestList() {
  try {
    const res = await apiFetch('/api/digests');
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    if (!data.ok) return;
    const sel = document.getElementById('dateSelect');
    sel.innerHTML = data.data.map(d => `<option value="${d.date}">${d.date}</option>`).join('');
    if (!data.data.length) sel.innerHTML = '<option>暂无</option>';
  } catch {}
}

async function loadLatest() {
  try {
    const res = await apiFetch('/api/digest/latest');
    if (res.status === 401) { showLogin(); return; }
    const data = await res.json();
    if (data.ok) { renderDigest(data.data); loadDigestList(); }
    else document.getElementById('emptyState').classList.remove('hidden');
  } catch { document.getElementById('emptyState').classList.remove('hidden'); }
}

document.getElementById('dateSelect').addEventListener('change', async e => {
  const date = e.target.value;
  if (!date || date === '暂无') return;
  try { const res = await apiFetch(`/api/digest/${date}`); const data = await res.json(); if (data.ok) renderDigest(data.data); } catch {}
});

async function checkRunning() {
  try { const res = await apiFetch('/api/status'); const data = await res.json(); if (data.ok && data.data.running) watchStatus(); } catch {}
}

(async () => {
  // Check if this is a share page first (no auth needed)
  const isShare = await checkSharePage();
  if (isShare) return;
  // Normal auth flow
  const ok = await checkAuth();
  if (ok) { loadLatest(); loadDigestList(); checkRunning(); }
})();
