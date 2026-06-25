'use strict';

/**
 * 고객사 CS 응대 기록 서비스 - 서버
 * - 로그인 없음 (사내망 전용)
 * - Express + PostgreSQL
 * 실행: node server.js  (보통은 docker compose 로 기동)
 */

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 정규화/검증 ─────────────────────────────────────

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

function normalizeBody(body = {}) {
  const priority = db.PRIORITIES.includes(body.priority) ? body.priority : 'medium';
  const status = db.STATUSES.includes(body.status) ? body.status : 'received';
  const channel = db.CHANNELS.includes(body.channel) ? body.channel : 'phone';
  return {
    customer: str(body.customer),
    contact: str(body.contact),
    title: str(body.title),
    channel,
    category: str(body.category),
    priority,
    status,
    assignee: str(body.assignee),
    content: str(body.content),
    resolution: str(body.resolution),
    occurred_at: str(body.occurred_at),
    resolved_at: str(body.resolved_at),
  };
}

// ── CSV용 한글 매핑 ─────────────────────────────────

const PRIORITY_KO = { high: '높음', medium: '보통', low: '낮음' };
const STATUS_KO = { received: '접수', in_progress: '처리중', done: '완료', hold: '보류' };
const CHANNEL_KO = { phone: '전화', email: '이메일', chat: '채팅', visit: '방문', other: '기타' };

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** ISO 타임스탬프 → 'YYYY-MM-DD HH:mm' */
function fmtTs(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 발생~해결 소요시간을 사람이 읽기 좋게 ('2일 3시간' 등) */
function durationText(from, to) {
  if (!from || !to) return '';
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
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

// ── API ─────────────────────────────────────────────

app.get('/api/health', (req, res) => res.json({ ok: true }));

// CSV 내보내기 (목록 라우트보다 먼저 등록)
app.get('/api/tickets/export.csv', async (req, res, next) => {
  try {
    const tickets = await db.listTickets();
    const header = [
      '고객사', '문의자', '제목', '접수경로', '유형', '중요도', '처리상태', '담당자',
      '발생일시', '해결일시', '소요시간', '문의내용', '해결내용', '등록일', '수정일',
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const t of tickets) {
      lines.push([
        t.customer, t.contact, t.title,
        CHANNEL_KO[t.channel] || t.channel,
        t.category,
        PRIORITY_KO[t.priority] || t.priority,
        STATUS_KO[t.status] || t.status,
        t.assignee,
        t.occurred_at, t.resolved_at,
        durationText(t.occurred_at, t.resolved_at),
        t.content, t.resolution,
        fmtTs(t.created_at), fmtTs(t.updated_at),
      ].map(csvEscape).join(','));
    }
    const csv = '\uFEFF' + lines.join('\r\n'); // 엑셀 한글 깨짐 방지 BOM
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cs_tickets_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// 목록
app.get('/api/tickets', async (req, res, next) => {
  try { res.json(await db.listTickets()); } catch (err) { next(err); }
});

// 생성
app.post('/api/tickets', async (req, res, next) => {
  try {
    const body = normalizeBody(req.body);
    if (!body.customer) return res.status(400).json({ error: '고객사는 필수입니다.' });
    res.status(201).json(await db.createTicket(body));
  } catch (err) { next(err); }
});

// 수정
app.put('/api/tickets/:id', async (req, res, next) => {
  try {
    const body = normalizeBody(req.body);
    if (!body.customer) return res.status(400).json({ error: '고객사는 필수입니다.' });
    const t = await db.updateTicket(req.params.id, body);
    if (!t) return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    res.json(t);
  } catch (err) { next(err); }
});

// 상태만 변경 (보드 드래그용)
app.patch('/api/tickets/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!db.STATUSES.includes(status)) {
      return res.status(400).json({ error: '올바르지 않은 상태값입니다.' });
    }
    const cur = await db.getTicket(req.params.id);
    if (!cur) return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    // 완료로 옮기는데 해결일시가 비어있으면 현재 시각 자동 기록
    let resolvedAt;
    if (status === 'done' && !cur.resolved_at) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      resolvedAt = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    const t = await db.patchTicketStatus(req.params.id, status, resolvedAt);
    res.json(t);
  } catch (err) { next(err); }
});

// 삭제
app.delete('/api/tickets/:id', async (req, res, next) => {
  try {
    const t = await db.deleteTicket(req.params.id);
    if (!t) return res.status(404).json({ error: '해당 기록을 찾을 수 없습니다.' });
    res.json(t);
  } catch (err) { next(err); }
});

// 공통 에러 핸들러
app.use((err, req, res, next) => {
  console.error('[오류]', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ── 기동 ────────────────────────────────────────────

db.init()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('────────────────────────────────────────────');
      console.log(' 고객사 CS 응대 기록 서비스 실행 중');
      console.log(` 로컬:   http://localhost:${PORT}`);
      console.log(` 사내망:  http://<서버 IP>:${PORT}`);
      console.log('────────────────────────────────────────────');
    });
  })
  .catch((err) => {
    console.error('[치명적] DB 초기화 실패. 종료합니다.', err);
    process.exit(1);
  });
