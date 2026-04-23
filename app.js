/* =====================================================
   Journal PWA — app.js
   ===================================================== */

'use strict';

// ===== IndexedDB =====
const DB_NAME = 'journal-db';
const DB_VERSION = 1;
const STORE = 'entries';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('dayKey', 'dayKey', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetByDay(dayKey) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('dayKey');
    const req = idx.getAll(dayKey);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDeleteByDay(dayKey) {
  return new Promise(async (resolve, reject) => {
    try {
      const entries = await dbGetByDay(dayKey);
      for (const e of entries) await dbDelete(e.id);
      resolve();
    } catch (err) { reject(err); }
  });
}

// ===== Date / Time Helpers =====

function localDayKey(date) {
  // YYYY-MM-DD based on local time
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDatetimeLocal(iso) {
  // ISO → "YYYY-MM-DDTHH:MM" for datetime-local input (local time)
  if (!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function fromDatetimeLocal(val) {
  // "YYYY-MM-DDTHH:MM" → ISO string (treated as local time)
  if (!val) return null;
  return new Date(val).toISOString();
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const diff = Math.floor((new Date(endIso) - new Date(startIso)) / 1000 / 60);
  if (diff < 60) return `${diff}分`;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

function formatElapsed(startIso) {
  const diff = Math.floor((Date.now() - new Date(startIso)) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatDayLabel(dayKey) {
  const [y, mo, da] = dayKey.split('-').map(Number);
  const d = new Date(y, mo - 1, da);
  return `${y}年${mo}月${da}日（${WEEKDAYS[d.getDay()]}）`;
}

function todayLabel() {
  const d = new Date();
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  return `${mo}月${da}日（${wd}）`;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ===== App State =====
let state = {
  currentView: 'home',      // 'home' | 'history' | 'day-detail'
  detailDayKey: null,
  activeEntryId: null,      // ID of in-progress activity
  bannerInterval: null,
  editingEmotionId: null,   // null = new, string = editing
  editingDetailId: null,    // entry being shown in detail modal
  pendingConfirm: null,     // { resolve, reject }
};

// ===== DOM References =====
const $ = (id) => document.getElementById(id);

const activeBanner = $('active-banner');
const bannerTitle = $('banner-title');
const bannerElapsed = $('banner-elapsed');
const bannerEndBtn = $('banner-end-btn');

const views = {
  home: $('view-home'),
  history: $('view-history'),
  'day-detail': $('view-day-detail'),
};

const navItems = document.querySelectorAll('.nav-item');
const todayDateEl = $('today-date');
const todayTimeline = $('today-timeline');
const todayEmpty = $('today-empty');
const historyList = $('history-list');
const detailTimeline = $('detail-timeline');
const detailViewTitle = $('detail-view-title');

// ===== Navigation =====

function showView(name) {
  state.currentView = name;
  Object.entries(views).forEach(([k, v]) => {
    v.classList.toggle('active', k === name);
  });
  navItems.forEach((btn) => {
    const isActive = btn.dataset.view === name;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  if (name === 'home') renderToday();
  if (name === 'history') renderHistory();
}

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.view;
    if (v) showView(v);
  });
});

$('back-from-detail').addEventListener('click', () => showView('history'));

// ===== Render Today =====

async function renderToday() {
  todayDateEl.textContent = todayLabel();
  const dayKey = localDayKey();
  const entries = await dbGetByDay(dayKey);
  // 今日のタイムラインは新しい順（上が最新）
  entries.sort((a, b) => {
    const ta = a.type === 'activity' ? a.startTime : a.timestamp;
    const tb = b.type === 'activity' ? b.startTime : b.timestamp;
    return new Date(tb) - new Date(ta);
  });

  // Clear existing cards (keep empty placeholder structure)
  const existing = todayTimeline.querySelectorAll('.entry-card');
  existing.forEach(el => el.remove());

  if (entries.length === 0) {
    todayEmpty.style.display = '';
  } else {
    todayEmpty.style.display = 'none';
    entries.forEach((entry) => {
      todayTimeline.appendChild(buildEntryCard(entry));
    });
  }
}

// ===== Render History =====

async function renderHistory() {
  const all = await dbGetAll();
  // Group by dayKey
  const map = {};
  all.forEach((e) => {
    if (!map[e.dayKey]) map[e.dayKey] = 0;
    map[e.dayKey]++;
  });

  const today = localDayKey();
  const days = Object.keys(map)
    .filter(k => k !== today)
    .sort((a, b) => b.localeCompare(a));

  historyList.innerHTML = '';

  if (days.length === 0) {
    historyList.innerHTML = `
      <div class="timeline-empty">
        <span class="timeline-empty-icon" aria-hidden="true">📅</span>
        <p class="timeline-empty-text">履歴がありません</p>
      </div>`;
    return;
  }

  days.forEach((dayKey) => {
    const count = map[dayKey];
    const item = document.createElement('div');
    item.className = 'history-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.innerHTML = `
      <div>
        <div class="history-date">${formatDayLabel(dayKey)}</div>
        <div class="history-count">${count}件の記録</div>
      </div>
      <span class="history-chevron" aria-hidden="true">›</span>
    `;
    item.addEventListener('click', () => showDayDetail(dayKey));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') showDayDetail(dayKey); });
    historyList.appendChild(item);
  });
}

// ===== Day Detail =====

async function showDayDetail(dayKey) {
  state.detailDayKey = dayKey;
  detailViewTitle.textContent = formatDayLabel(dayKey);
  await renderDayDetail();
  showView('day-detail');
}

async function renderDayDetail() {
  const dayKey = state.detailDayKey;
  const entries = await dbGetByDay(dayKey);
  entries.sort((a, b) => {
    const ta = a.type === 'activity' ? a.startTime : a.timestamp;
    const tb = b.type === 'activity' ? b.startTime : b.timestamp;
    return new Date(ta) - new Date(tb);
  });

  detailTimeline.innerHTML = '';
  if (entries.length === 0) {
    detailTimeline.innerHTML = `
      <div class="timeline-empty">
        <span class="timeline-empty-icon" aria-hidden="true">📓</span>
        <p class="timeline-empty-text">記録がありません</p>
      </div>`;
    return;
  }
  entries.forEach((entry) => {
    detailTimeline.appendChild(buildEntryCard(entry));
  });
}

// ===== Build Entry Card =====

function buildEntryCard(entry) {
  const card = document.createElement('div');
  const inProgress = entry.type === 'activity' && !entry.endTime;
  card.className = `entry-card ${entry.type}${inProgress ? ' in-progress' : ''}`;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.dataset.id = entry.id;

  let icon, titleText, subtitleText;

  if (entry.type === 'activity') {
    icon = '▶';
    titleText = entry.title || '（名前なし）';
    if (inProgress) {
      subtitleText = `${formatTime(entry.startTime)} 〜 進行中`;
    } else {
      const dur = formatDuration(entry.startTime, entry.endTime);
      subtitleText = `${formatTime(entry.startTime)} 〜 ${formatTime(entry.endTime)}${dur ? `（${dur}）` : ''}`;
    }
  } else {
    icon = '♥';
    titleText = entry.text || '（テキストなし）';
    subtitleText = formatTime(entry.timestamp);
  }

  card.innerHTML = `
    <span class="entry-icon" aria-hidden="true">${icon}</span>
    <div class="entry-content">
      <div class="entry-title">${escapeHtml(titleText)}</div>
      <div class="entry-subtitle">${escapeHtml(subtitleText)}</div>
    </div>
    ${inProgress ? '<span class="entry-badge in-progress" aria-label="進行中">進行中</span>' : ''}
  `;

  card.addEventListener('click', () => openEntryDetail(entry.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') openEntryDetail(entry.id);
  });
  return card;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Active Banner =====

function updateBanner() {
  if (!state.activeEntryId) {
    activeBanner.classList.remove('visible');
    if (state.bannerInterval) { clearInterval(state.bannerInterval); state.bannerInterval = null; }
    return;
  }
  dbGetAll().then((all) => {
    const entry = all.find(e => e.id === state.activeEntryId);
    if (!entry) { state.activeEntryId = null; updateBanner(); return; }
    activeBanner.classList.add('visible');
    bannerTitle.textContent = entry.title || '行動中';
    bannerElapsed.textContent = formatElapsed(entry.startTime);

    if (!state.bannerInterval) {
      state.bannerInterval = setInterval(() => {
        bannerElapsed.textContent = formatElapsed(entry.startTime);
      }, 1000);
    }
  });
}

bannerEndBtn.addEventListener('click', () => {
  openEndActivityModal();
});

// ===== Modal helpers =====

function openModal(id) {
  const overlay = $(id);
  overlay.classList.add('visible');
  // Focus first input
  setTimeout(() => {
    const inp = overlay.querySelector('input, textarea');
    if (inp) inp.focus();
  }, 350);
}

function closeModal(id) {
  const overlay = $(id);
  overlay.classList.remove('visible');
}

// Close buttons
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ===== Start Activity =====

$('btn-start-activity').addEventListener('click', () => {
  if (state.activeEntryId) {
    // Already running — open end modal
    openEndActivityModal();
    return;
  }
  $('activity-name-input').value = '';
  $('activity-start-time-input').value = toDatetimeLocal(new Date().toISOString());
  openModal('modal-activity-start');
});

$('btn-confirm-start').addEventListener('click', async () => {
  const name = $('activity-name-input').value.trim();
  if (!name) {
    $('activity-name-input').focus();
    $('activity-name-input').style.borderColor = 'var(--btn-destructive)';
    setTimeout(() => { $('activity-name-input').style.borderColor = ''; }, 1500);
    return;
  }
  const startTimeVal = $('activity-start-time-input').value;
  const startTime = startTimeVal ? fromDatetimeLocal(startTimeVal) : new Date().toISOString();
  const startDate = new Date(startTime);
  const entry = {
    id: generateId(),
    type: 'activity',
    title: name,
    startTime: startTime,
    endTime: null,
    dayKey: localDayKey(startDate),
  };
  await dbPut(entry);
  state.activeEntryId = entry.id;
  closeModal('modal-activity-start');
  updateBanner();
  if (state.currentView === 'home') renderToday();
});

// ===== End Activity =====

function openEndActivityModal() {
  if (!state.activeEntryId) return;
  dbGetAll().then((all) => {
    const entry = all.find(e => e.id === state.activeEntryId);
    if (!entry) return;
    $('end-activity-name').textContent = entry.title || '行動';
    $('activity-end-time-input').value = toDatetimeLocal(new Date().toISOString());
    openModal('modal-activity-end');
  });
}

$('btn-confirm-end').addEventListener('click', async () => {
  const endTimeVal = $('activity-end-time-input').value;
  const endTime = endTimeVal ? fromDatetimeLocal(endTimeVal) : new Date().toISOString();

  const all = await dbGetAll();
  const entry = all.find(e => e.id === state.activeEntryId);
  if (!entry) return;

  entry.endTime = endTime;
  // Update dayKey based on start time (already set correctly)
  await dbPut(entry);
  state.activeEntryId = null;
  closeModal('modal-activity-end');
  updateBanner();
  if (state.currentView === 'home') renderToday();
  if (state.currentView === 'day-detail') renderDayDetail();
});

// ===== Add Emotion =====

$('btn-add-emotion').addEventListener('click', () => {
  state.editingEmotionId = null;
  $('modal-emotion-title').textContent = '感情をメモ';
  $('emotion-text-input').value = '';
  $('emotion-time-input').value = toDatetimeLocal(new Date().toISOString());
  $('btn-save-emotion').textContent = '保存';
  openModal('modal-emotion');
});

$('btn-save-emotion').addEventListener('click', async () => {
  const text = $('emotion-text-input').value.trim();
  if (!text) {
    $('emotion-text-input').focus();
    $('emotion-text-input').style.borderColor = 'var(--btn-destructive)';
    setTimeout(() => { $('emotion-text-input').style.borderColor = ''; }, 1500);
    return;
  }
  const timeVal = $('emotion-time-input').value;
  const timestamp = timeVal ? fromDatetimeLocal(timeVal) : new Date().toISOString();
  const tsDate = new Date(timestamp);

  if (state.editingEmotionId) {
    // Update existing
    const all = await dbGetAll();
    const entry = all.find(e => e.id === state.editingEmotionId);
    if (entry) {
      entry.text = text;
      entry.timestamp = timestamp;
      entry.dayKey = localDayKey(tsDate);
      await dbPut(entry);
    }
  } else {
    const entry = {
      id: generateId(),
      type: 'emotion',
      text: text,
      timestamp: timestamp,
      dayKey: localDayKey(tsDate),
    };
    await dbPut(entry);
  }

  closeModal('modal-emotion');
  state.editingEmotionId = null;
  if (state.currentView === 'home') renderToday();
  if (state.currentView === 'day-detail') renderDayDetail();
});

// ===== Entry Detail Modal =====

async function openEntryDetail(id) {
  const all = await dbGetAll();
  const entry = all.find(e => e.id === id);
  if (!entry) return;
  state.editingDetailId = id;
  renderDetailModal(entry);
  openModal('modal-entry-detail');
}

function renderDetailModal(entry) {
  const body = $('modal-entry-detail-body');
  const isActivity = entry.type === 'activity';
  const inProgress = isActivity && !entry.endTime;

  let detailRows = '';
  if (isActivity) {
    const dur = (!inProgress && entry.endTime) ? formatDuration(entry.startTime, entry.endTime) : '';
    detailRows = `
      <div class="detail-row">
        <span class="detail-row-label">行動名</span>
        <span class="detail-row-value">${escapeHtml(entry.title || '')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">開始</span>
        <span class="detail-row-value">${formatTime(entry.startTime)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">終了</span>
        <span class="detail-row-value">${inProgress ? '進行中' : formatTime(entry.endTime)}</span>
      </div>
      ${dur ? `<div class="detail-row">
        <span class="detail-row-label">時間</span>
        <span class="detail-row-value">${escapeHtml(dur)}</span>
      </div>` : ''}
    `;
  } else {
    detailRows = `
      <div class="detail-row" style="align-items:flex-start">
        <span class="detail-row-label">内容</span>
        <span class="detail-row-value" style="white-space:pre-wrap">${escapeHtml(entry.text || '')}</span>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">時刻</span>
        <span class="detail-row-value">${formatTime(entry.timestamp)}</span>
      </div>
    `;
  }

  // Edit form
  let editFormHtml = '';
  if (isActivity) {
    editFormHtml = `
      <div class="edit-form" id="detail-edit-form">
        <div class="form-group">
          <label class="form-label" for="detail-edit-title">行動名</label>
          <input type="text" class="form-input" id="detail-edit-title" value="${escapeHtml(entry.title || '')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="detail-edit-start">開始時刻</label>
          <input type="datetime-local" class="form-datetime" id="detail-edit-start" value="${toDatetimeLocal(entry.startTime)}">
        </div>
        ${!inProgress ? `
        <div class="form-group">
          <label class="form-label" for="detail-edit-end">終了時刻</label>
          <input type="datetime-local" class="form-datetime" id="detail-edit-end" value="${toDatetimeLocal(entry.endTime)}">
        </div>` : ''}
        <div class="form-actions">
          <button class="btn" id="detail-edit-cancel" style="background:var(--bg-tertiary);color:var(--text-primary)">キャンセル</button>
          <button class="btn btn-primary" id="detail-edit-save">保存</button>
        </div>
      </div>
    `;
  } else {
    editFormHtml = `
      <div class="edit-form" id="detail-edit-form">
        <div class="form-group">
          <label class="form-label" for="detail-edit-text">内容</label>
          <textarea class="form-textarea" id="detail-edit-text">${escapeHtml(entry.text || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label" for="detail-edit-time">時刻</label>
          <input type="datetime-local" class="form-datetime" id="detail-edit-time" value="${toDatetimeLocal(entry.timestamp)}">
        </div>
        <div class="form-actions">
          <button class="btn" id="detail-edit-cancel" style="background:var(--bg-tertiary);color:var(--text-primary)">キャンセル</button>
          <button class="btn btn-primary" id="detail-edit-save">保存</button>
        </div>
      </div>
    `;
  }

  body.innerHTML = `
    <span class="detail-type-badge ${entry.type}">
      ${isActivity ? '▶ 行動' : '♥ 感情'}
    </span>
    <div class="detail-section">
      ${detailRows}
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px;">
      <button class="btn" id="detail-btn-edit" style="flex:1;background:var(--bg-tertiary);color:var(--text-primary)">編集</button>
      <button class="btn btn-destructive" id="detail-btn-delete" style="flex:1">削除</button>
    </div>
    ${editFormHtml}
  `;

  // Edit toggle
  const editBtn = body.querySelector('#detail-btn-edit');
  const editForm = body.querySelector('#detail-edit-form');
  const cancelBtn = body.querySelector('#detail-edit-cancel');
  const saveBtn = body.querySelector('#detail-edit-save');
  const deleteBtn = body.querySelector('#detail-btn-delete');

  editBtn.addEventListener('click', () => {
    editForm.classList.toggle('visible');
    editBtn.textContent = editForm.classList.contains('visible') ? 'キャンセル' : '編集';
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      editForm.classList.remove('visible');
      editBtn.textContent = '編集';
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const all = await dbGetAll();
      const e = all.find(x => x.id === state.editingDetailId);
      if (!e) return;

      if (isActivity) {
        const titleEl = body.querySelector('#detail-edit-title');
        const startEl = body.querySelector('#detail-edit-start');
        const endEl = body.querySelector('#detail-edit-end');
        if (!titleEl.value.trim()) { titleEl.focus(); return; }
        e.title = titleEl.value.trim();
        if (startEl.value) e.startTime = fromDatetimeLocal(startEl.value);
        if (endEl && endEl.value) e.endTime = fromDatetimeLocal(endEl.value);
        e.dayKey = localDayKey(new Date(e.startTime));
      } else {
        const textEl = body.querySelector('#detail-edit-text');
        const timeEl = body.querySelector('#detail-edit-time');
        if (!textEl.value.trim()) { textEl.focus(); return; }
        e.text = textEl.value.trim();
        if (timeEl.value) e.timestamp = fromDatetimeLocal(timeEl.value);
        e.dayKey = localDayKey(new Date(e.timestamp));
      }

      await dbPut(e);
      closeModal('modal-entry-detail');
      if (state.currentView === 'home') renderToday();
      if (state.currentView === 'day-detail') renderDayDetail();
    });
  }

  deleteBtn.addEventListener('click', async () => {
    const confirmed = await showConfirm('エントリーを削除', 'この記録を削除しますか？この操作は元に戻せません。');
    if (!confirmed) return;

    if (state.activeEntryId === state.editingDetailId) {
      state.activeEntryId = null;
      updateBanner();
    }
    await dbDelete(state.editingDetailId);
    closeModal('modal-entry-detail');
    if (state.currentView === 'home') renderToday();
    if (state.currentView === 'day-detail') renderDayDetail();
  });
}

// ===== Day Detail Actions =====

$('btn-share-today').addEventListener('click', async () => {
  const dayKey = localDayKey();
  const entries = await dbGetByDay(dayKey);
  if (entries.length === 0) { showToast('記録がありません'); return; }
  const text = await buildExportText(dayKey);
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (e) {
      if (e.name !== 'AbortError') fallbackCopyToClipboard(text);
    }
  } else {
    fallbackCopyToClipboard(text);
  }
});

$('btn-share-day').addEventListener('click', async () => {
  const dayKey = state.detailDayKey;
  if (!dayKey) return;
  const text = await buildExportText(dayKey);
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch (e) {
      if (e.name !== 'AbortError') {
        fallbackCopyToClipboard(text);
      }
    }
  } else {
    fallbackCopyToClipboard(text);
  }
});

async function buildExportText(dayKey) {
  const entries = await dbGetByDay(dayKey);
  entries.sort((a, b) => {
    const ta = a.type === 'activity' ? a.startTime : a.timestamp;
    const tb = b.type === 'activity' ? b.startTime : b.timestamp;
    return new Date(ta) - new Date(tb);
  });

  const header = formatDayLabel(dayKey);
  const lines = entries.map((e) => {
    if (e.type === 'activity') {
      const start = formatTime(e.startTime);
      const end = e.endTime ? formatTime(e.endTime) : '進行中';
      const dur = e.endTime ? ` (${formatDuration(e.startTime, e.endTime)})` : '';
      return `• [行動] ${start}〜${end}${dur} ${e.title || ''}`;
    } else {
      return `• [感情] ${formatTime(e.timestamp)} ${e.text || ''}`;
    }
  });

  return `${header}\n\n${lines.join('\n')}`;
}

async function fallbackCopyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('クリップボードにコピーしました');
  } catch (e) {
    showToast('書き出しに失敗しました');
  }
}

$('btn-delete-day').addEventListener('click', async () => {
  const dayKey = state.detailDayKey;
  if (!dayKey) return;
  const confirmed = await showConfirm('この日を削除', `${formatDayLabel(dayKey)} の記録をすべて削除しますか？`);
  if (!confirmed) return;
  await dbDeleteByDay(dayKey);
  showView('history');
});

// ===== Confirm Dialog =====

function showConfirm(title, message) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-overlay').classList.add('visible');

    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      $('confirm-overlay').classList.remove('visible');
      $('confirm-ok').removeEventListener('click', onOk);
      $('confirm-cancel').removeEventListener('click', onCancel);
    };

    $('confirm-ok').addEventListener('click', onOk);
    $('confirm-cancel').addEventListener('click', onCancel);
  });
}

// ===== Toast =====

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));left:50%;
      transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;
      padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;
      pointer-events:none;transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ===== Service Worker Registration =====

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      console.log('SW registered:', reg.scope);
    }).catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ===== Init =====

async function init() {
  await openDB();

  // Set today's date
  todayDateEl.textContent = todayLabel();

  // Check for any in-progress activity
  const all = await dbGetAll();
  const inProgress = all.find(e => e.type === 'activity' && !e.endTime);
  if (inProgress) {
    state.activeEntryId = inProgress.id;
    updateBanner();
  }

  // Initial render
  await renderToday();
}

init().catch(console.error);
