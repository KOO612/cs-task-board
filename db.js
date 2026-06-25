'use strict';

/**
 * DB 계층 (PostgreSQL) - 고객사 CS 응대 기록
 * - ORM 없이 pg 드라이버 + 파라미터 바인딩 쿼리만 사용
 * - 시작 시 테이블 자동 생성 (별도 마이그레이션 도구 불필요)
 * - DB 기동을 기다리는 연결 재시도 로직 포함
 */

const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'csuser',
        password: process.env.PGPASSWORD || 'cspass',
        database: process.env.PGDATABASE || 'csdb',
      }
);

// 허용 값 (DB·코드 검증 공통)
const PRIORITIES = ['high', 'medium', 'low'];                 // 중요도
const STATUSES = ['received', 'in_progress', 'done', 'hold']; // 처리상태: 접수/처리중/완료/보류
const CHANNELS = ['phone', 'email', 'chat', 'visit', 'other']; // 접수경로: 전화/이메일/채팅/방문/기타

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS tickets (
    id           BIGSERIAL   PRIMARY KEY,
    customer     TEXT        NOT NULL,
    contact      TEXT        NOT NULL DEFAULT '',
    title        TEXT        NOT NULL DEFAULT '',
    channel      TEXT        NOT NULL DEFAULT 'phone',
    category     TEXT        NOT NULL DEFAULT '',
    priority     TEXT        NOT NULL DEFAULT 'medium',
    status       TEXT        NOT NULL DEFAULT 'received',
    assignee     TEXT        NOT NULL DEFAULT '',
    content      TEXT        NOT NULL DEFAULT '',
    resolution   TEXT        NOT NULL DEFAULT '',
    occurred_at  TEXT        NOT NULL DEFAULT '',
    resolved_at  TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function init(retries = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      await pool.query(CREATE_SQL);
      console.log('[DB] 연결 및 스키마 준비 완료');
      return;
    } catch (err) {
      console.log(`[DB] 연결 대기 중... (${attempt}/${retries}) ${err.code || err.message}`);
      if (attempt === retries) throw err;
      await sleep(delayMs);
    }
  }
}

// ── CRUD ──────────────────────────────────────────────

const COLS = [
  'customer', 'contact', 'title', 'channel', 'category', 'priority',
  'status', 'assignee', 'content', 'resolution', 'occurred_at', 'resolved_at',
];

async function listTickets() {
  const { rows } = await pool.query('SELECT * FROM tickets ORDER BY created_at DESC');
  return rows;
}

async function getTicket(id) {
  const { rows } = await pool.query('SELECT * FROM tickets WHERE id=$1', [id]);
  return rows[0] || null;
}

async function createTicket(t) {
  const vals = COLS.map((c) => t[c]);
  const ph = COLS.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `INSERT INTO tickets (${COLS.join(',')}) VALUES (${ph}) RETURNING *`,
    vals
  );
  return rows[0];
}

async function updateTicket(id, t) {
  const sets = COLS.map((c, i) => `${c}=$${i + 1}`).join(', ');
  const vals = COLS.map((c) => t[c]);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE tickets SET ${sets}, updated_at=now() WHERE id=$${vals.length} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

/** 상태만 변경 (보드 드래그용). 완료로 옮기면 해결일시가 비어있을 때 자동 기록 */
async function patchTicketStatus(id, status, resolvedAt) {
  const sets = ['status=$1', 'updated_at=now()'];
  const params = [status];
  if (resolvedAt !== undefined) {
    params.push(resolvedAt);
    sets.push(`resolved_at=$${params.length}`);
  }
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE tickets SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`,
    params
  );
  return rows[0] || null;
}

async function deleteTicket(id) {
  const { rows } = await pool.query('DELETE FROM tickets WHERE id=$1 RETURNING *', [id]);
  return rows[0] || null;
}

module.exports = {
  pool, init,
  listTickets, getTicket, createTicket, updateTicket, patchTicketStatus, deleteTicket,
  PRIORITIES, STATUSES, CHANNELS,
};
