const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || './data/neuro.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT (datetime('now')),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    referrer TEXT,
    first_lesson INTEGER,
    ref_from TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    name TEXT,
    email TEXT,
    telegram TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    lesson_source INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER,
    event TEXT,
    lesson INTEGER,
    value TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS survey (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    occupation TEXT,
    pain TEXT,
    source TEXT,
    goal TEXT,
    completed BOOLEAN DEFAULT 0,
    abandoned_at_question INTEGER,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER,
    lesson INTEGER,
    amount INTEGER,
    reason TEXT,
    expires_at DATETIME,
    used BOOLEAN DEFAULT 0,
    used_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_id INTEGER,
    amount INTEGER,
    points_used INTEGER,
    discount INTEGER,
    status TEXT DEFAULT 'pending',
    robokassa_id TEXT,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_session_id TEXT,
    friend_session_id TEXT,
    points_awarded INTEGER DEFAULT 0,
    awarded_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
  CREATE INDEX IF NOT EXISTS idx_points_session ON points(session_id);
  CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_referrals_ref ON referrals(ref_session_id);
  CREATE INDEX IF NOT EXISTS idx_referrals_friend ON referrals(friend_session_id);
`);

module.exports = db;
