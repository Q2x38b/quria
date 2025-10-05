// Use Vercel proxy in production
const API_BASE_URL = '';
const CHAT_COMPLETIONS_PATH = '/api/sonar';
const STORAGE_KEY = 'PPLX_API_KEY';

// UI elements
const queryInput = document.getElementById('queryInput');
const searchForm = document.getElementById('searchForm');
const resultsEl = document.getElementById('results');
const toastEl = document.getElementById('toast');
const segButtons = Array.from(document.querySelectorAll('.segmented .seg'));
const apiKeyBtn = document.getElementById('apiKeyBtn');
const apiKeyDialog = document.getElementById('apiKeyDialog');
const apiKeyForm = document.getElementById('apiKeyForm');
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleKeyVisBtn = document.getElementById('toggleKeyVis');
const clearKeyBtn = document.getElementById('clearKeyBtn');

let currentMode = 'answer'; // 'answer' | 'sources'
let inFlightController = null;

// Utilities
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function setApiKey(key) {
  if (!key) return localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, key);
}

function abortInFlight() {
  if (inFlightController) {
    try { inFlightController.abort(); } catch (_) {}
    inFlightController = null;
  }
}

function getFaviconUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(u.origin)}`;
  } catch { return 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; }
}

function uniqueUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, '');
      if (!seen.has(host)) { seen.add(host); out.push(u); }
    } catch {}
  }
  return out;
}

function extractUrlsFromText(text) {
  if (!text) return [];
  const regex = /(https?:\/\/[\w\-\.]+\.[a-z]{2,}(?:\/[\w\-\.\/%#?&=]*)?)/gi;
  const matches = text.match(regex) || [];
  return matches;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      return res;
    }
    const delay = (2 ** attempt + Math.random()) * 1000;
    await sleep(delay);
  }
  // Last attempt
  const final = await fetch(url, options);
  if (!final.ok) {
    const text = await final.text().catch(() => '');
    throw new Error(`HTTP ${final.status}: ${text || final.statusText}`);
  }
  return final;
}

async function askSonar(query) {

  abortInFlight();
  inFlightController = new AbortController();

  const body = {
    model: 'sonar',
    messages: [
      { role: 'system', content: 'You are a concise, factual assistant. Cite sources where applicable.' },
      { role: 'user', content: query }
    ],
    temperature: 0.2
  };

  const res = await fetchWithRetry(`${API_BASE_URL}${CHAT_COMPLETIONS_PATH}`,
    {
      method: 'POST',
      headers: {
        // Authorization handled by serverless proxy
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: inFlightController.signal
    }
  );

  const data = await res.json();
  const choice = data?.choices?.[0];
  const message = choice?.message || {};
  const content = message?.content || '';
  // Citations may appear in message.citations or top-level data.citations
  const citations = Array.isArray(message?.citations) ? message.citations : (Array.isArray(data?.citations) ? data.citations : []);
  return { content, citations };
}

function setLoading(isLoading) {
  const btn = document.getElementById('submitBtn');
  btn.disabled = isLoading;
  if (isLoading) {
    btn.innerHTML = '<span class="spinner"></span><span>Searching…</span>';
  } else {
    btn.textContent = 'Search';
  }
}

function renderAnswer(content) {
  const card = document.createElement('div');
  card.className = 'rounded-2xl border border-white/10 bg-zinc-900 shadow-glow';
  const body = document.createElement('div');
  body.className = 'p-4 whitespace-pre-wrap text-[1.02rem]';
  body.textContent = content || 'No answer.';
  card.appendChild(body);
  resultsEl.appendChild(card);
}

function renderSources(urls) {
  const card = document.createElement('div');
  card.className = 'rounded-2xl border border-white/10 bg-zinc-900 shadow-glow';
  const body = document.createElement('div');
  body.className = 'p-4 grid gap-3';

  const label = document.createElement('div');
  label.className = 'text-[0.75rem] uppercase tracking-wider text-zinc-400 font-semibold';
  label.textContent = 'Sources';
  body.appendChild(label);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2';

  if (!urls.length) {
    const none = document.createElement('div');
    none.className = 'text-zinc-400 text-sm';
    none.textContent = 'No sources detected.';
    body.appendChild(none);
  } else {
    for (const raw of urls) {
      let host = '';
      try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch {}
      const a = document.createElement('a');
      a.className = 'grid place-items-center gap-2 rounded-xl border border-white/10 bg-zinc-800 px-2 py-3 text-center hover:bg-zinc-700 no-underline text-zinc-100';
      a.href = raw;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';

      const img = document.createElement('img');
      img.className = 'h-7 w-7 rounded-md bg-zinc-900';
      img.alt = '';
      img.src = getFaviconUrl(raw);
      img.onerror = () => { img.style.visibility = 'hidden'; };

      const span = document.createElement('div');
      span.className = 'max-w-[120px] truncate text-xs text-zinc-400';
      span.textContent = host || 'source';

      a.appendChild(img);
      a.appendChild(span);
      grid.appendChild(a);
    }
    body.appendChild(grid);
  }

  card.appendChild(body);
  resultsEl.appendChild(card);
}

async function handleSearch(evt) {
  evt?.preventDefault();
  const q = (queryInput.value || '').trim();
  if (!q) return;
  resultsEl.innerHTML = '';
  setLoading(true);
  try {
    const { content, citations } = await askSonar(q);
    const foundUrls = uniqueUrls((citations || []).length ? citations : extractUrlsFromText(content));
    if (currentMode === 'answer') {
      renderAnswer(content);
      renderSources(foundUrls);
    } else {
      renderSources(foundUrls);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Request failed');
  } finally {
    setLoading(false);
  }
}

// Optional: batch search utility (not used by UI, provided for convenience)
async function batchSearch(queries, batchSize = 3, delayMs = 1000) {
  const outputs = [];
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const promises = batch.map(q => askSonar(q).catch(e => ({ error: e?.message || String(e) })));
    const res = await Promise.all(promises);
    outputs.push(...res);
    if (i + batchSize < queries.length) await sleep(delayMs);
  }
  return outputs;
}

// Events
searchForm.addEventListener('submit', handleSearch);
queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    queryInput.blur();
  }
});

for (const b of segButtons) {
  b.addEventListener('click', () => {
    for (const bb of segButtons) {
      const isActive = bb === b;
      bb.classList.toggle('active', isActive);
      // Tailwind style toggles for the tabs
      bb.classList.toggle('text-zinc-200', isActive);
      bb.classList.toggle('text-zinc-400', !isActive);
      bb.classList.toggle('bg-zinc-800', isActive);
      bb.setAttribute('aria-selected', String(bb === b));
    }
    currentMode = b.dataset.mode;
    // Re-render current results by re-submitting if content exists
    if ((queryInput.value || '').trim().length > 0) {
      handleSearch(new Event('submit'));
    }
  });
}

apiKeyBtn.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  apiKeyDialog.showModal();
});

toggleKeyVisBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

clearKeyBtn.addEventListener('click', () => {
  setApiKey('');
  apiKeyInput.value = '';
  showToast('API key cleared');
});

apiKeyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = (apiKeyInput.value || '').trim();
  if (!key) {
    setApiKey('');
    apiKeyDialog.close();
    showToast('API key cleared');
    return;
  }
  setApiKey(key);
  apiKeyDialog.close();
  showToast('API key saved');
});

// Prefocus input on load
window.addEventListener('load', () => {
  if (getApiKey()) {
    queryInput.focus();
  } else {
    showToast('Set your Perplexity API key (gear icon)');
  }
});


