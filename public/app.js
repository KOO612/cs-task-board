'use strict';

// ── 상수/매핑 ──────────────────────────────────
const PRIORITY_KO = { high: '높음', medium: '보통', low: '낮음' };
const STATUS_KO = { received: '접수', in_progress: '처리중', done: '완료', hold: '보류' };
const CHANNEL_KO = { phone: '전화', email: '이메일', chat: '채팅', visit: '방문', other: '기타' };
const STATUS_ORDER = ['received', 'in_progress', 'done', 'hold'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const OPEN_RANK = { received: 0, in_progress: 0, hold: 1, done: 2 };

// ── 상태 ───────────────────────────────────────
let all = [];
const ui = { search: '', status: '', priority: '', channel: '', customer: '', assignee: '', sort: 'created_desc', view: 'list' };
let draggingId = null;
let justDragged = false;

// ── DOM ────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const rowsEl = $('#rows');
const tableEl = $('#table');
const kanbanEl = $('#kanban');
const emptyEl = $('#empty');
const drawer = $('#drawer');

// ── 유틸 ───────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 'YYYY-MM-DDTHH:mm' → 'MM/DD HH:mm' */
function fmtDT(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return esc(s);
  return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
}

/** 소요/경과 시간을 '2일 3시간' 형태로 */
function durationText(from, to) {
  if (!from || !to) return '';
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b)) return '';
  let min = Math.round((b - a) / 60000);
  if (min < 0) return '';
  const d = Math.floor(min / 1440); min -= d * 1440;
  const h = Math.floor(min / 60); min -= h * 60;
  const parts = [];
  if (d) parts.push(`${d}일`);
  if (h) parts.push(`${h}시간`);
  if (min || parts.length === 0) parts.push(`${min}분`);
  return parts.join(' ');
}

/** 현재 시각을 datetime-local 형식으로 */
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 장기 미해결 여부: 완료/보류가 아니고 발생 후 72시간 경과 */
function isStale(t) {
  if (t.status === 'done' || t.status === 'hold' || !t.occurred_at) return false;
  const occ = new Date(t.occurred_at);
  if (isNaN(occ)) return false;
  return (Date.now() - occ) > 72 * 3600 * 1000;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2400);
}

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(url, opt);
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `요청 실패 (${res.status})`);
  return data;
}

// ── 로드 & 옵션 ────────────────────────────────
async function load() {
  try {
    all = await api('GET', '/api/tickets');
    refreshSelectOptions();
    refreshDatalists();
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

function uniqSorted(key) {
  return [...new Set(all.map((t) => t[key]).filter(Boolean))].sort();
}

function fillSelect(sel, values, allLabel) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = values.includes(cur) ? cur : '';
}

function refreshSelectOptions() {
  fillSelect($('#filter-customer'), uniqSorted('customer'), '고객사 전체');
  fillSelect($('#filter-assignee'), uniqSorted('assignee'), '담당자 전체');
}

function refreshDatalists() {
  const opt = (v) => `<option value="${esc(v)}"></option>`;
  $('#customer-list').innerHTML = uniqSorted('customer').map(opt).join('');
  $('#category-list').innerHTML = uniqSorted('category').map(opt).join('');
  $('#assignee-list').innerHTML = uniqSorted('assignee').map(opt).join('');
}

// ── 필터/정렬 ──────────────────────────────────
function applyFilters(list, ignoreStatus = false) {
  let out = list.slice();
  if (!ignoreStatus && ui.status) out = out.filter((t) => t.status === ui.status);
  if (ui.priority) out = out.filter((t) => t.priority === ui.priority);
  if (ui.channel) out = out.filter((t) => t.channel === ui.channel);
  if (ui.customer) out = out.filter((t) => t.customer === ui.customer);
  if (ui.assignee) out = out.filter((t) => t.assignee === ui.assignee);
  if (ui.search) {
    const q = ui.search.toLowerCase();
    out = out.filter((t) =>
      [t.customer, t.contact, t.title, t.content, t.resolution, t.assignee, t.category]
        .some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const cmp = {
    created_desc: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    created_asc: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    occurred_desc: (a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || ''),
    occurred_asc: (a, b) => (a.occurred_at || '\uffff').localeCompare(b.occurred_at || '\uffff'),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    open_first: (a, b) => (OPEN_RANK[a.status] - OPEN_RANK[b.status]) || (new Date(b.created_at) - new Date(a.created_at)),
  }[ui.sort];
  return cmp ? out.sort(cmp) : out;
}

function updateStats() {
  const c = { all: all.length, received: 0, in_progress: 0, done: 0, hold: 0 };
  all.forEach((t) => { c[t.status] = (c[t.status] || 0) + 1; });
  $('#stat-all').textContent = c.all;
  $('#stat-received').textContent = c.received;
  $('#stat-in_progress').textContent = c.in_progress;
  $('#stat-done').textContent = c.done;
  $('#stat-hold').textContent = c.hold;
  document.querySelectorAll('.stat').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.status === ui.status)));
}

// ── 셀 빌더 ────────────────────────────────────
function timeCell(t) {
  const occ = t.occurred_at ? fmtDT(t.occurred_at) : '<span class="no-val">미입력</span>';
  const res = t.resolved_at ? fmtDT(t.resolved_at) : '<span class="no-val">미해결</span>';
  let badge = '';
  if (t.resolved_at && t.occurred_at) {
    const d = durationText(t.occurred_at, t.resolved_at);
    if (d) badge = `<span class="dur-badge" data-d="solved">소요 ${d}</span>`;
  } else if (t.status !== 'done') {
    if (t.occurred_at) {
      const el = durationText(t.occurred_at, new Date());
      const d = isStale(t) ? 'stale' : 'open';
      badge = `<span class="dur-badge" data-d="${d}">미해결 ${el} 경과</span>`;
    }
  }
  return `${occ} <span class="arrow">→</span> ${res}${badge ? '<br>' + badge : ''}`;
}

function chips(t) {
  let h = `<span class="pri-dot" data-p="${t.priority}">${PRIORITY_KO[t.priority]}</span>`;
  if (t.category) h += `<span class="tag">${esc(t.category)}</span>`;
  h += `<span class="chip-channel">${CHANNEL_KO[t.channel] || t.channel}</span>`;
  return h;
}

// ── 목록(테이블) 뷰 ────────────────────────────
function rowHTML(t) {
  const title = t.title
    ? `<div class="cust-title">${esc(t.title)}</div>`
    : `<div class="cust-title is-empty">(제목 없음)</div>`;
  const summarySrc = t.resolution
    ? `<span class="lead">해결:</span> ${esc(t.resolution)}`
    : (t.content ? esc(t.content) : '');
  const staleCls = isStale(t) ? ' is-stale' : '';
  return `
    <div class="row${staleCls}" data-id="${t.id}" data-priority="${t.priority}" role="row">
      <div class="cell-customer">
        <div class="cust-name">${esc(t.customer)}${t.contact ? ` <span class="no-val">· ${esc(t.contact)}</span>` : ''}</div>
        ${title}
        <div class="cust-meta">${chips(t)}</div>
      </div>
      <div class="cell-assignee">${t.assignee ? esc(t.assignee) : '<span class="no-val">미지정</span>'}</div>
      <div class="cell-time">${timeCell(t)}</div>
      <div class="cell-status"><span class="pill" data-s="${t.status}">${STATUS_KO[t.status]}</span></div>
      <div class="cell-summary">${summarySrc}</div>
      <div class="cell-actions">
        <button class="iconbtn" data-act="edit" title="수정">✎</button>
        <button class="iconbtn" data-act="delete" title="삭제">🗑</button>
      </div>
    </div>`;
}

function renderList() {
  tableEl.hidden = false;
  kanbanEl.hidden = true;
  const list = applyFilters(all);
  if (list.length === 0) {
    rowsEl.innerHTML = '';
    tableEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector('.empty__title').textContent =
      all.length === 0 ? '표시할 기록이 없습니다' : '조건에 맞는 기록이 없습니다';
    return;
  }
  emptyEl.hidden = true;
  rowsEl.innerHTML = list.map(rowHTML).join('');
}

// ── 보드(칸반) 뷰 ──────────────────────────────
function cardHTML(t) {
  return `
    <div class="kcard" data-id="${t.id}" data-priority="${t.priority}" draggable="true">
      <div class="kcard__cust">${esc(t.customer)}</div>
      <div class="kcard__title">${t.title ? esc(t.title) : '(제목 없음)'}</div>
      <div class="kcard__meta">
        ${t.assignee ? `<span class="meta-chip">👤 ${esc(t.assignee)}</span>` : ''}
        <span class="pri-dot" data-p="${t.priority}">${PRIORITY_KO[t.priority]}</span>
        <span class="chip-channel">${CHANNEL_KO[t.channel] || t.channel}</span>
        ${isStale(t) ? '<span class="dur-badge" data-d="stale">장기 미해결</span>' : ''}
      </div>
    </div>`;
}

function renderBoard() {
  tableEl.hidden = true;
  emptyEl.hidden = true;
  kanbanEl.hidden = false;
  const list = applyFilters(all, true);
  kanbanEl.innerHTML = STATUS_ORDER.map((st) => {
    const items = list.filter((t) => t.status === st);
    const cards = items.length ? items.map(cardHTML).join('') : '<div class="kcol__empty">비어 있음</div>';
    return `
      <div class="kcol" data-status="${st}">
        <div class="kcol__head">${STATUS_KO[st]}<span class="kcol__count">${items.length}</span></div>
        <div class="kcol__body">${cards}</div>
      </div>`;
  }).join('');
}

function render() {
  updateStats();
  if (ui.view === 'board') renderBoard();
  else renderList();
}

// ── 드로어(입력 패널) ──────────────────────────
function openDrawer(t) {
  const isEdit = !!t;
  $('#drawer-title').textContent = isEdit ? '응대 기록 수정' : '새 응대 기록';
  $('#f-id').value = isEdit ? t.id : '';
  $('#f-customer').value = isEdit ? t.customer : '';
  $('#f-contact').value = isEdit ? t.contact : '';
  $('#f-title').value = isEdit ? t.title : '';
  $('#f-channel').value = isEdit ? t.channel : 'phone';
  $('#f-category').value = isEdit ? t.category : '';
  $('#f-priority').value = isEdit ? t.priority : 'medium';
  $('#f-status').value = isEdit ? t.status : 'received';
  $('#f-assignee').value = isEdit ? t.assignee : '';
  $('#f-occurred').value = isEdit ? t.occurred_at : nowLocal();
  $('#f-resolved').value = isEdit ? t.resolved_at : '';
  $('#f-content').value = isEdit ? t.content : '';
  $('#f-resolution').value = isEdit ? t.resolution : '';
  $('#err-customer').textContent = '';
  $('#delete-btn').hidden = !isEdit;
  drawer.hidden = false;
  $('.drawer__body').scrollTop = 0;
  setTimeout(() => $('#f-customer').focus(), 30);
}

function closeDrawer() { drawer.hidden = true; }

function collectForm() {
  return {
    id: $('#f-id').value,
    customer: $('#f-customer').value.trim(),
    contact: $('#f-contact').value.trim(),
    title: $('#f-title').value.trim(),
    channel: $('#f-channel').value,
    category: $('#f-category').value.trim(),
    priority: $('#f-priority').value,
    status: $('#f-status').value,
    assignee: $('#f-assignee').value.trim(),
    occurred_at: $('#f-occurred').value,
    resolved_at: $('#f-resolved').value,
    content: $('#f-content').value.trim(),
    resolution: $('#f-resolution').value.trim(),
  };
}

async function save() {
  const f = collectForm();
  if (!f.customer) {
    $('#err-customer').textContent = '고객사는 필수입니다.';
    $('#f-customer').focus();
    return;
  }
  if (f.occurred_at && f.resolved_at && f.resolved_at < f.occurred_at) {
    if (!confirm('해결 일시가 발생 일시보다 빠릅니다. 그대로 저장할까요?')) return;
  }
  const btn = $('#save-btn');
  btn.disabled = true;
  try {
    if (f.id) { await api('PUT', `/api/tickets/${f.id}`, f); toast('수정했습니다.'); }
    else { await api('POST', '/api/tickets', f); toast('등록했습니다.'); }
    closeDrawer();
    await load();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function removeTicket(id) {
  const t = all.find((x) => String(x.id) === String(id));
  if (!t) return;
  if (!confirm(`"${t.customer}" 응대 기록을 삭제할까요?`)) return;
  try {
    await api('DELETE', `/api/tickets/${id}`);
    toast('삭제했습니다.');
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

async function changeStatus(id, status) {
  const t = all.find((x) => String(x.id) === String(id));
  if (!t || t.status === status) return;
  try {
    await api('PATCH', `/api/tickets/${id}/status`, { status });
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

// ── 이벤트 ─────────────────────────────────────
$('#new-btn').addEventListener('click', () => openDrawer(null));
$('#save-btn').addEventListener('click', save);
$('#delete-btn').addEventListener('click', () => {
  const id = $('#f-id').value;
  if (id) { closeDrawer(); removeTicket(id); }
});
$('#resolved-now').addEventListener('click', () => {
  $('#f-resolved').value = nowLocal();
  if ($('#f-status').value !== 'done') $('#f-status').value = 'done';
});

drawer.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeDrawer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

// 목록 행
rowsEl.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = row.dataset.id;
  const t = all.find((x) => String(x.id) === String(id));
  const act = e.target.closest('[data-act]');
  if (act) {
    e.stopPropagation();
    if (act.dataset.act === 'delete') removeTicket(id);
    else openDrawer(t);
    return;
  }
  if (t) openDrawer(t);
});

// 칸반: 클릭으로 열기 + 드래그앤드롭
kanbanEl.addEventListener('click', (e) => {
  if (justDragged) return;
  const card = e.target.closest('.kcard');
  if (!card) return;
  const t = all.find((x) => String(x.id) === String(card.dataset.id));
  if (t) openDrawer(t);
});
kanbanEl.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.kcard');
  if (!card) return;
  draggingId = card.dataset.id;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', draggingId); } catch (_) {}
});
kanbanEl.addEventListener('dragend', (e) => {
  const card = e.target.closest('.kcard');
  if (card) card.classList.remove('dragging');
  kanbanEl.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
  justDragged = true;
  setTimeout(() => { justDragged = false; }, 50);
  draggingId = null;
});
kanbanEl.addEventListener('dragover', (e) => {
  const col = e.target.closest('.kcol');
  if (!col || draggingId == null) return;
  e.preventDefault();
  kanbanEl.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
  col.classList.add('drop-target');
});
kanbanEl.addEventListener('drop', (e) => {
  const col = e.target.closest('.kcol');
  if (!col || draggingId == null) return;
  e.preventDefault();
  changeStatus(draggingId, col.dataset.status);
});

// 보기 전환
document.querySelectorAll('.viewtoggle__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    ui.view = btn.dataset.view;
    document.querySelectorAll('.viewtoggle__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    render();
  });
});

// 필터/검색/정렬
$('#search').addEventListener('input', (e) => { ui.search = e.target.value.trim(); render(); });
$('#filter-customer').addEventListener('change', (e) => { ui.customer = e.target.value; render(); });
$('#filter-priority').addEventListener('change', (e) => { ui.priority = e.target.value; render(); });
$('#filter-channel').addEventListener('change', (e) => { ui.channel = e.target.value; render(); });
$('#filter-assignee').addEventListener('change', (e) => { ui.assignee = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; render(); });

document.querySelectorAll('.stat').forEach((btn) => {
  btn.addEventListener('click', () => {
    ui.status = (ui.status === btn.dataset.status) ? '' : btn.dataset.status;
    render();
  });
});

// 시작
load();
