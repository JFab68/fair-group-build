const Database = require('better-sqlite3');
const config = require('./config');
const logger = require('./logger');

let db;

function getDb() {
  if (!db) {
    db = new Database(config.database.path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info('Database connection established', { path: config.database.path });
  }
  return db;
}

function initialize() {
  const conn = getDb();

  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT,
      city TEXT,
      county TEXT,
      interestAreas TEXT,
      hearAboutUs TEXT,
      statement TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      role TEXT NOT NULL DEFAULT 'member',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastLoginAt DATETIME
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preapproved_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      addedBy TEXT,
      addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      token TEXT NOT NULL,
      expiresAt DATETIME NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adminId INTEGER,
      adminEmail TEXT,
      action TEXT NOT NULL,
      targetType TEXT,
      targetId INTEGER,
      details TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
    CREATE INDEX IF NOT EXISTS idx_reset_tokens_token ON password_reset_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
  `);

  logger.info('Database schema initialized');
}

// --- User Operations ---

function createUser({ firstName, lastName, email, password, phone, city, county, interestAreas, statement }) {
  const stmt = getDb().prepare(`
    INSERT INTO users (firstName, lastName, email, password, phone, city, county, interestAreas, statement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(firstName, lastName, email, password, phone, city, county, interestAreas, statement);
  return result.lastInsertRowid;
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function updateUserStatus(id, status) {
  const stmt = getDb().prepare('UPDATE users SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(status, id);
}

function updateUserRole(id, role) {
  const stmt = getDb().prepare('UPDATE users SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(role, id);
}

function updateLastLogin(id) {
  const stmt = getDb().prepare('UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(id);
}

function updateUserPassword(id, hashedPassword) {
  const stmt = getDb().prepare('UPDATE users SET password = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?');
  return stmt.run(hashedPassword, id);
}

function getAllUsers() {
  return getDb().prepare('SELECT id, firstName, lastName, email, phone, city, county, interestAreas, status, role, createdAt, lastLoginAt FROM users ORDER BY createdAt DESC').all();
}

function getPendingUsers() {
  return getDb().prepare('SELECT id, firstName, lastName, email, phone, city, county, interestAreas, statement, createdAt FROM users WHERE status = ? ORDER BY createdAt ASC').all('pending');
}

// --- Preapproved Email Operations ---

function addPreapprovedEmail(email, addedBy) {
  const stmt = getDb().prepare('INSERT OR IGNORE INTO preapproved_emails (email, addedBy) VALUES (?, ?)');
  return stmt.run(email, addedBy || null);
}

function removePreapprovedEmail(id) {
  return getDb().prepare('DELETE FROM preapproved_emails WHERE id = ?').run(id);
}

function getPreapprovedEmails() {
  return getDb().prepare('SELECT * FROM preapproved_emails ORDER BY addedAt DESC').all();
}

function isEmailPreapproved(email) {
  const row = getDb().prepare('SELECT id FROM preapproved_emails WHERE email = ?').get(email);
  return !!row;
}

// --- Session Operations (custom store) ---

function getSession(sid) {
  const row = getDb().prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?').get(sid, Date.now());
  return row ? JSON.parse(row.sess) : null;
}

function setSession(sid, sess, expire) {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
  stmt.run(sid, JSON.stringify(sess), expire);
}

function destroySession(sid) {
  getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

function cleanExpiredSessions() {
  const result = getDb().prepare('DELETE FROM sessions WHERE expire <= ?').run(Date.now());
  if (result.changes > 0) {
    logger.debug('Cleaned expired sessions', { count: result.changes });
  }
}

// --- Password Reset Operations ---

function createResetToken(userId, hashedToken, expiresAt) {
  getDb().prepare('DELETE FROM password_reset_tokens WHERE userId = ?').run(userId);
  const stmt = getDb().prepare('INSERT INTO password_reset_tokens (userId, token, expiresAt) VALUES (?, ?, ?)');
  return stmt.run(userId, hashedToken, expiresAt);
}

function findResetToken(hashedToken) {
  return getDb().prepare('SELECT * FROM password_reset_tokens WHERE token = ? AND expiresAt > ?').get(hashedToken, new Date().toISOString());
}

function deleteResetToken(id) {
  getDb().prepare('DELETE FROM password_reset_tokens WHERE id = ?').run(id);
}

function deleteUserResetTokens(userId) {
  getDb().prepare('DELETE FROM password_reset_tokens WHERE userId = ?').run(userId);
}

// --- Audit Log Operations ---

function createAuditLog({ adminId, adminEmail, action, targetType, targetId, details, ipAddress, userAgent }) {
  const stmt = getDb().prepare(`
    INSERT INTO audit_logs (adminId, adminEmail, action, targetType, targetId, details, ipAddress, userAgent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(adminId, adminEmail, action, targetType, targetId, JSON.stringify(details), ipAddress, userAgent);
}

function getAuditLogs({ page = 1, limit = 25, action = null } = {}) {
  const offset = (page - 1) * limit;
  let query = 'SELECT * FROM audit_logs';
  let countQuery = 'SELECT COUNT(*) as total FROM audit_logs';
  const params = [];

  if (action) {
    query += ' WHERE action = ?';
    countQuery += ' WHERE action = ?';
    params.push(action);
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  const countParams = [...params];
  params.push(limit, offset);

  const logs = getDb().prepare(query).all(...params);
  const { total } = getDb().prepare(countQuery).get(...countParams);

  return { logs, total, page, totalPages: Math.ceil(total / limit) };
}

function close() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

module.exports = {
  initialize,
  createUser,
  findUserByEmail,
  findUserById,
  updateUserStatus,
  updateUserRole,
  updateLastLogin,
  updateUserPassword,
  getAllUsers,
  getPendingUsers,
  addPreapprovedEmail,
  removePreapprovedEmail,
  getPreapprovedEmails,
  isEmailPreapproved,
  getSession,
  setSession,
  destroySession,
  cleanExpiredSessions,
  createResetToken,
  findResetToken,
  deleteResetToken,
  deleteUserResetTokens,
  createAuditLog,
  getAuditLogs,
  close,
};
