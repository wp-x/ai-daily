/**
 * AI 每日精选 — UX Enhancements
 * Features: progress bar · scroll animations · skeleton · back-to-top
 *           toast · category counts · keyboard shortcuts · PWA
 */

/* ══════════════════════════════════════════════════════════════
   1. READING PROGRESS BAR
   ══════════════════════════════════════════════════════════════ */
(function initProgressBar() {
  const bar = document.getElementById('readingProgress');
  if (!bar) return;
  function update() {
    const scrollTop = window.scrollY;
    const docH = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${docH > 0 ? scrollTop / docH : 0})`;
  }
  window.addEventListener('scroll', update, { passive: true });
})();

/* ══════════════════════════════════════════════════════════════
   2. BACK TO TOP
   ══════════════════════════════════════════════════════════════ */
(function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 380);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
})();

/* ══════════════════════════════════════════════════════════════
   3. TOAST NOTIFICATION SYSTEM
   ══════════════════════════════════════════════════════════════ */
window.showToast = function(message, type = 'info', sub = '') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = { success: '✓', error: '✕', info: 'ℹ' }[type] || 'ℹ';
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <span class="toast-msg">${message}</span>
      ${sub ? `<span class="toast-sub">${sub}</span>` : ''}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);
  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 320);
  }, type === 'error' ? 5000 : 3200);
};

/* ══════════════════════════════════════════════════════════════
   4. SKELETON LOADING
   ══════════════════════════════════════════════════════════════ */
(function initSkeleton() {
  const skeleton = document.getElementById('skeletonView');
  const mainApp  = document.getElementById('mainApp');
  if (!skeleton || !mainApp) return;

  // Show skeleton when app becomes visible, until digest renders
  let shown = false;
  const maybeShow = () => {
    if (shown) return;
    if (!mainApp.classList.contains('hidden')) {
      shown = true;
      skeleton.classList.remove('hidden');
    }
  };
  const observer = new MutationObserver(maybeShow);
  observer.observe(mainApp, { attributes: true, attributeFilter: ['class'] });
  maybeShow(); // check immediately

  // Hide skeleton once content is ready
  document.addEventListener('digestRendered', () => {
    skeleton.classList.add('hidden');
    observer.disconnect();
  });

  // Also hide if empty state shown
  document.addEventListener('emptyStateShown', () => {
    skeleton.classList.add('hidden');
    observer.disconnect();
  });
})();

/* ══════════════════════════════════════════════════════════════
   5. PANEL STAGGER ANIMATION ON CONTENT LOAD
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('digestRendered', () => {
  const sections = document.querySelectorAll('#mainApp main > section:not(.hidden)');
  sections.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(12px)';
    el.style.transition = 'none';
    setTimeout(() => {
      el.style.transition = 'opacity 0.38s ease, transform 0.38s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 90);
  });
});

/* ══════════════════════════════════════════════════════════════
   6. CATEGORY COUNT BADGES
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('digestRendered', ({ detail: { digest } }) => {
  if (!digest?.articles) return;

  const counts = { all: digest.articles.length };
  digest.articles.forEach(a => {
    counts[a.category] = (counts[a.category] || 0) + 1;
  });

  document.querySelectorAll('.cat-btn').forEach(btn => {
    const cat = btn.dataset.cat;
    const n = counts[cat] ?? 0;
    // Remove any existing count badge
    const old = btn.querySelector('.cat-count');
    if (old) old.remove();
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'cat-count';
      badge.textContent = n;
      btn.appendChild(badge);
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   7. KEYBOARD SHORTCUTS
   ══════════════════════════════════════════════════════════════ */
(function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Don't intercept when typing in an input
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    switch (e.key) {
      case '/':
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
        break;
      case 'g': case 'G':
        document.getElementById('generateBtn')?.click();
        break;
      case 's': case 'S':
        document.getElementById('settingsBtn')?.click();
        break;
      case 't': case 'T':
        document.getElementById('themeToggle')?.click();
        break;
      case 'Escape': {
        // Close any open modal
        const modals = document.querySelectorAll('.modal-bg:not(.hidden)');
        modals.forEach(m => m.classList.add('hidden'));
        break;
      }
      case '?':
        window.showToast('快捷键: / 搜索 · G 生成 · S 设置 · T 主题 · Esc 关闭', 'info');
        break;
    }
  });
})();

/* ══════════════════════════════════════════════════════════════
   8. PWA SERVICE WORKER REGISTRATION
   ══════════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // silently fail if sw.js not present
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   DARK MODE — Complete CSS var injection
   (CSS handles the styles; this ensures smooth transition)
   ══════════════════════════════════════════════════════════════ */
(function initDarkTransition() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    document.documentElement.style.transition = 'background-color 0.25s, color 0.25s';
    setTimeout(() => { document.documentElement.style.transition = ''; }, 300);
  });
})();

/* ══════════════════════════════════════════════════════════════
   ARTICLE TRANSLATION MODAL
   ══════════════════════════════════════════════════════════════ */
(function initTranslation() {
  const modal   = document.getElementById('translateModal');
  const loading = document.getElementById('tmLoading');
  const errBox  = document.getElementById('tmError');
  const errMsg  = document.getElementById('tmErrorMsg');
  const content = document.getElementById('tmContent');
  const tmTitle = document.getElementById('tmTitle');
  const tmSumm  = document.getElementById('tmSummary');
  const tmBody  = document.getElementById('tmBody');
  const tmClose = document.getElementById('tmClose');
  const tmOrig  = document.getElementById('tmOrigLink');
  const tmFall  = document.getElementById('tmFallbackLink');
  const tmStatus = document.getElementById('tmStatus');
  if (!modal) return;

  let currentES = null; // active EventSource

  function openModal() {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (currentES) { currentES.close(); currentES = null; }
  }
  function showLoading(msg) {
    loading.classList.remove('hidden');
    errBox.classList.add('hidden');
    content.classList.add('hidden');
    const txt = document.getElementById('tmLoadingText');
    if (txt) txt.textContent = msg || '正在抓取原文并翻译，请稍候…';
  }
  function showError(msg, url) {
    loading.classList.add('hidden');
    errBox.classList.remove('hidden');
    content.classList.add('hidden');
    errMsg.textContent = msg;
    tmFall.href = url;
  }

  // Append a paragraph chunk to body (streaming)
  let pendingText = '';
  let currentPara = null;
  function appendChunk(text) {
    loading.classList.add('hidden');
    content.classList.remove('hidden');
    pendingText += text;
    // Split on double newlines to create paragraphs
    const parts = pendingText.split(/\n\n/);
    pendingText = parts.pop(); // last part may be incomplete
    for (const part of parts) {
      if (part.trim()) {
        const p = document.createElement('p');
        p.innerHTML = part.replace(/\n/g, '<br>');
        tmBody.appendChild(p);
        currentPara = null;
      }
    }
    // Stream remaining text into current paragraph
    if (pendingText) {
      if (!currentPara) {
        currentPara = document.createElement('p');
        currentPara.className = 'tm-streaming';
        tmBody.appendChild(currentPara);
      }
      currentPara.innerHTML = pendingText.replace(/\n/g, '<br>');
    }
    // Auto-scroll modal
    const box = modal.querySelector('.translate-modal-box');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function flushPending() {
    if (pendingText.trim() && currentPara) {
      currentPara.classList.remove('tm-streaming');
      currentPara.innerHTML = pendingText.replace(/\n/g, '<br>');
    }
    pendingText = '';
    currentPara = null;
  }

  function startStream(url, title, desc) {
    pendingText = '';
    currentPara = null;
    tmBody.innerHTML = '';
    tmTitle.textContent = '';
    tmSumm.textContent = '';

    const params = new URLSearchParams({
      url:   url,
      title: title.slice(0, 200),
      desc:  desc.slice(0, 500),
    });

    const es = new EventSource(`/api/article/translate/stream?${params}`);
    currentES = es;

    es.addEventListener('status', (e) => {
      const d = JSON.parse(e.data);
      showLoading(d.msg);
    });

    es.addEventListener('meta', (e) => {
      const d = JSON.parse(e.data);
      loading.classList.add('hidden');
      content.classList.remove('hidden');
      tmTitle.textContent = d.titleZh || '';
      tmSumm.textContent  = d.summary  || '';
      // Show divider
      const div = document.querySelector('.tm-divider');
      if (div) div.style.display = '';
    });

    es.addEventListener('chunk', (e) => {
      const d = JSON.parse(e.data);
      appendChunk(d.text || '');
    });

    es.addEventListener('done', () => {
      flushPending();
      es.close(); currentES = null;
    });

    es.addEventListener('error', (e) => {
      es.close(); currentES = null;
      try {
        const d = JSON.parse(e.data);
        showError(d.error || '翻译失败', url);
      } catch {
        // SSE connection error (not our error event)
        if (tmBody.children.length === 0) showError('连接中断，请重试', url);
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        if (tmBody.children.length === 0 && content.classList.contains('hidden')) {
          showError('连接失败，请检查网络', url);
        }
        currentES = null;
      }
    };
  }

  // Attach click handlers after digest renders
  function attachHandlers() {
    document.querySelectorAll('.article-card a[href], .top-card a[href]').forEach(link => {
      if (link.dataset.translateBound) return;
      link.dataset.translateBound = '1';

      link.addEventListener('click', (e) => {
        const url   = link.href;
        const title = link.closest('[data-title]')?.dataset.title
                   || link.closest('.article-card, .top-card')?.querySelector('h3,h4')?.textContent
                   || link.textContent || '';
        const desc  = link.closest('.article-card, .top-card')?.querySelector('.article-desc, p')?.textContent || '';

        if (!url || url.startsWith(location.origin)) return;
        e.preventDefault();

        tmOrig.href = url;
        tmFall.href = url;
        openModal();
        showLoading();
        startStream(url, title, desc);
      });
    });
  }

  tmClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  document.addEventListener('digestRendered', () => setTimeout(attachHandlers, 100));
})();