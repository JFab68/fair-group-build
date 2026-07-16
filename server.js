const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const csrf = require('csrf');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const xss = require('xss');
const path = require('path');

const config = require('./config');
const db = require('./database');
const email = require('./emailService');
const logger = require('./logger');

const app = express();
const csrfTokens = new csrf();

// --- Initialize Database ---
db.initialize();

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new class SQLiteStore extends session.Store {
    constructor() { super(); setInterval(() => db.cleanExpiredSessions(), config.session.cleanupInterval); }
    get(sid, callback) {
      try { callback(null, db.getSession(sid)); }
      catch (err) { callback(err); }
    }
    set(sid, sess, callback) {
      try {
        const expire = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + config.session.maxAge;
        db.setSession(sid, sess, expire);
        callback(null);
      } catch (err) { callback(err); }
    }
    destroy(sid, callback) {
      try { db.destroySession(sid); callback(null); }
      catch (err) { callback(err); }
    }
  }(),
  secret: config.session.secret,
  name: config.session.name,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.server.env === 'production',
    httpOnly: true,
    maxAge: config.session.maxAge,
    sameSite: 'lax',
  },
}));

// --- Page-level route guards (must come BEFORE static serving) ---
function guardRolePage(requiredRole) {
  return (req, res, next) => {
    const role = req.session?.userRole;
    if (!role) return res.redirect('/login.html');
    if (requiredRole === 'admin' && role !== 'admin') return res.redirect('/dashboard.html');
    next();
  };
}

// Protected member pages
app.get('/dashboard.html', guardRolePage('member'));
app.get('/profile.html', guardRolePage('member'));
app.get('/subcommittee.html', guardRolePage('member'));
app.get('/resources.html', guardRolePage('member'));
app.get('/advocacy-toolkit.html', guardRolePage('member'));

// Admin-only pages
app.get('/admin.html', guardRolePage('admin'));

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = db.findUserById(req.session.userId);
  if (!user || user.status !== 'approved') {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function verifyCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'] || req.body._csrf;
  if (!token || !csrfTokens.verify(csrfSecret, token)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

function sanitizeInput(str) {
  return str ? xss(str.trim()) : '';
}

const csrfSecret = csrfTokens.secretSync();

// --- Rate Limiters ---
const signupLimiter = rateLimit({
  windowMs: config.rateLimit.signup.windowMs,
  max: config.rateLimit.signup.max,
  message: { error: 'Too many signup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  max: config.rateLimit.login.max,
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetLimiter = rateLimit({
  windowMs: config.rateLimit.passwordReset.windowMs,
  max: config.rateLimit.passwordReset.max,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Public API Routes ---

app.get('/api/csrf-token', (req, res) => {
  const token = csrfTokens.create(csrfSecret);
  res.json({ csrfToken: token });
});

app.post('/api/signup', signupLimiter, verifyCsrf, [
  body('firstName').trim().isLength({ min: config.validation.name.min, max: config.validation.name.max }).withMessage('First name is required'),
  body('lastName').trim().isLength({ min: config.validation.name.min, max: config.validation.name.max }).withMessage('Last name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: config.validation.password.min, max: config.validation.password.max }).withMessage(`Password must be ${config.validation.password.min}-${config.validation.password.max} characters`),
  body('phone').optional().trim().isLength({ max: config.validation.phone.max }),
  body('city').optional().trim().isLength({ max: config.validation.city.max }),
  body('county').optional().trim().isLength({ max: config.validation.county.max }),
  body('statement').optional().trim().isLength({ max: config.validation.statement.max }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const existing = db.findUserByEmail(req.body.email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const hashedPassword = await bcrypt.hash(req.body.password, config.security.bcryptRounds);
    const userData = {
      firstName: sanitizeInput(req.body.firstName),
      lastName: sanitizeInput(req.body.lastName),
      email: req.body.email,
      password: hashedPassword,
      phone: sanitizeInput(req.body.phone),
      city: sanitizeInput(req.body.city),
      county: sanitizeInput(req.body.county),
      interestAreas: sanitizeInput(req.body.interestAreas),
      statement: sanitizeInput(req.body.statement),
    };

    const userId = db.createUser(userData);
    logger.info('New user registered', { userId, email: userData.email });

    email.notifyAdminNewSignup(userData);

    const message = db.isEmailPreapproved(userData.email)
      ? 'Registration successful. You can now log in.'
      : 'Registration successful. Your application is pending review.';

    res.status(201).json({ message });
  } catch (error) {
    logger.error('Signup error', { error: error.message });
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/login', loginLimiter, verifyCsrf, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Valid email and password are required' });

  try {
    const user = db.findUserByEmail(req.body.email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const passwordMatch = await bcrypt.compare(req.body.password, user.password);
    if (!passwordMatch) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.status !== 'approved') {
      const messages = {
        pending: 'Your account is pending approval. You will receive an email when approved.',
        rejected: 'Your account application was not approved. Please contact us for more information.',
      };
      return res.status(403).json({ error: messages[user.status] || 'Account access denied' });
    }

    db.updateLastLogin(user.id);
    req.session.userId = user.id;
    req.session.userRole = user.role;

    logger.info('User logged in', { userId: user.id, email: user.email });

    res.json({
      message: 'Login successful',
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error', { error: err.message });
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie(config.session.name);
    logger.info('User logged out', { userId });
    res.json({ message: 'Logged out successfully' });
  });
});

app.post('/api/password-reset/request', resetLimiter, verifyCsrf, [
  body('email').isEmail().normalizeEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Valid email is required' });

  try {
    const user = db.findUserByEmail(req.body.email);
    if (user) {
      const rawToken = crypto.randomBytes(config.security.resetTokenBytes).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + config.security.resetTokenExpiry).toISOString();

      db.createResetToken(user.id, hashedToken, expiresAt);
      email.sendPasswordResetEmail(user, rawToken);
      logger.info('Password reset requested', { userId: user.id });
    }

    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
  } catch (error) {
    logger.error('Password reset request error', { error: error.message });
    res.status(500).json({ error: 'Request failed. Please try again.' });
  }
});

app.post('/api/password-reset/confirm', verifyCsrf, [
  body('token').notEmpty(),
  body('password').isLength({ min: config.validation.password.min, max: config.validation.password.max }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Valid token and password are required' });

  try {
    const hashedToken = crypto.createHash('sha256').update(req.body.token).digest('hex');
    const resetRecord = db.findResetToken(hashedToken);

    if (!resetRecord) return res.status(400).json({ error: 'Invalid or expired reset token' });

    const hashedPassword = await bcrypt.hash(req.body.password, config.security.bcryptRounds);
    db.updateUserPassword(resetRecord.userId, hashedPassword);
    db.deleteUserResetTokens(resetRecord.userId);

    logger.info('Password reset completed', { userId: resetRecord.userId });
    res.json({ message: 'Password has been reset successfully. You can now log in.' });
  } catch (error) {
    logger.error('Password reset confirm error', { error: error.message });
    res.status(500).json({ error: 'Password reset failed. Please try again.' });
  }
});

// --- Authenticated Routes ---

app.get('/api/user/profile', requireAuth, (req, res) => {
  const { password, ...profile } = req.user;
  res.json(profile);
});

// --- Admin Routes ---

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json(users);
  } catch (error) {
    logger.error('Get users error', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

app.get('/api/admin/users/pending', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.getPendingUsers();
    res.json(users);
  } catch (error) {
    logger.error('Get pending users error', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve pending users' });
  }
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, verifyCsrf, [
  body('status').optional().isIn(['approved', 'rejected', 'pending']),
  body('role').optional().isIn(['member', 'admin']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const targetUser = db.findUserById(parseInt(req.params.id, 10));
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const changes = {};

    if (req.body.status && req.body.status !== targetUser.status) {
      db.updateUserStatus(targetUser.id, req.body.status);
      changes.status = { from: targetUser.status, to: req.body.status };

      if (req.body.status === 'approved') email.sendApprovalEmail(targetUser);
      else if (req.body.status === 'rejected') email.sendRejectionEmail(targetUser);
    }

    if (req.body.role && req.body.role !== targetUser.role) {
      db.updateUserRole(targetUser.id, req.body.role);
      changes.role = { from: targetUser.role, to: req.body.role };
    }

    db.createAuditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'user_update',
      targetType: 'user',
      targetId: targetUser.id,
      details: changes,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    logger.info('Admin updated user', { adminId: req.user.id, targetId: targetUser.id, changes });
    res.json({ message: 'User updated successfully', changes });
  } catch (error) {
    logger.error('Update user error', { error: error.message });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.get('/api/admin/audit-logs', requireAuth, requireAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const action = req.query.action || null;

    const result = db.getAuditLogs({ page, limit, action });
    res.json(result);
  } catch (error) {
    logger.error('Get audit logs error', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

app.get('/api/admin/preapproved-emails', requireAuth, requireAdmin, (req, res) => {
  try {
    const emails = db.getPreapprovedEmails();
    res.json(emails);
  } catch (error) {
    logger.error('Get preapproved emails error', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve preapproved emails' });
  }
});

app.post('/api/admin/preapproved-emails', requireAuth, requireAdmin, verifyCsrf, [body('email').isEmail().normalizeEmail()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    db.addPreapprovedEmail(req.body.email, req.user.email);
    db.createAuditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'preapproved_email_added',
      targetType: 'preapproved_email',
      targetId: null,
      details: { email: req.body.email },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.status(201).json({ message: 'Email added to preapproved list' });
  } catch (error) {
    logger.error('Add preapproved email error', { error: error.message });
    res.status(500).json({ error: 'Failed to add preapproved email' });
  }
});

app.delete('/api/admin/preapproved-emails/:id', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  try {
    db.removePreapprovedEmail(parseInt(req.params.id, 10));
    db.createAuditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: 'preapproved_email_removed',
      targetType: 'preapproved_email',
      targetId: parseInt(req.params.id, 10),
      details: {},
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.json({ message: 'Email removed from preapproved list' });
  } catch (error) {
    logger.error('Remove preapproved email error', { error: error.message });
    res.status(500).json({ error: 'Failed to remove preapproved email' });
  }
});

// --- Static file serving (after guards so protected pages are checked first) ---
app.use('/dist', express.static(path.join(__dirname, 'dist')));
app.use('/src/js', express.static(path.join(__dirname, 'src', 'js')));
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: 'index.html',
}));

// --- Health / Monitoring ---

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/ready', (req, res) => {
  try {
    db.findUserById(0);
    res.json({ status: 'ready', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'not ready', database: 'disconnected' });
  }
});

app.get('/metrics', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = db.getAllUsers();
    const pending = users.filter(u => u.status === 'pending').length;
    const approved = users.filter(u => u.status === 'approved').length;
    const rejected = users.filter(u => u.status === 'rejected').length;
    res.json({
      users: { total: users.length, pending, approved, rejected },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// --- Start Server ---

const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(`FAIR Group server running on port ${PORT}`, { env: config.server.env });
  console.log(`Server running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => { logger.info('Server shutting down'); db.close(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('Server shutting down'); db.close(); process.exit(0); });
