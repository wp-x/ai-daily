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
  if (!modal) return;

  function openModal() {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function showLoading() {
    loading.classList.remove('hidden');
    errBox.classList.add('hidden');
    content.classList.add('hidden');
  }
  function showError(msg, url) {
    loading.classList.add('hidden');
    errBox.classList.remove('hidden');
    content.classList.add('hidden');
    errMsg.textContent = msg;
    tmFall.href = url;
  }
  function showContent(data) {
    loading.classList.add('hidden');
    errBox.classList.add('hidden');
    content.classList.remove('hidden');
    tmTitle.textContent = data.titleZh || '';
    tmSumm.textContent  = data.summary  || '';
    // Render paragraphs
    const paras = (data.content || '').split(/\n\n+/).filter(Boolean);
    tmBody.innerHTML = paras.map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
  }

  // Attach click handlers after digest renders
  function attachHandlers() {
    // Target article title links and article cards
    document.querySelectorAll('.article-card a[href], .top-card a[href]').forEach(link => {
      if (link.dataset.translateBound) return;
      link.dataset.translateBound = '1';

      link.addEventListener('click', async (e) => {
        const url   = link.href;
        const title = link.closest('[data-title]')?.dataset.title
                   || link.closest('.article-card, .top-card')?.querySelector('h3,h4')?.textContent
                   || link.textContent || '';
        const desc  = link.closest('.article-card, .top-card')?.querySelector('.article-desc, p')?.textContent || '';

        // Only intercept external links
        if (!url || url.startsWith(location.origin)) return;
        e.preventDefault();

        tmOrig.href = url;
        tmFall.href = url;
        openModal();
        showLoading();

        try {
          const params = new URLSearchParams({
            url:   url,
            title: title.slice(0, 200),
            desc:  desc.slice(0, 500),
          });
          const res  = await fetch(`/api/article/translate?${params}`);
          const data = await res.json();
          if (data.ok) {
            showContent(data);
          } else {
            showError(data.error || '翻译失败', url);
          }
        } catch (err) {
          showError('网络错误，无法完成翻译', url);
        }
      });
    });
  }

  // Close handlers
  tmClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // Attach after content renders
  document.addEventListener('digestRendered', () => {
    setTimeout(attachHandlers, 100);
  });
})();
