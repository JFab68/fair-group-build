require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    name: 'fair.sid',
    maxAge: 24 * 60 * 60 * 1000,
    cleanupInterval: 15 * 60 * 1000,
  },
  database: {
    path: process.env.DATABASE_PATH || './database.sqlite',
  },
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
    resetTokenBytes: 32,
    resetTokenExpiry: 60 * 60 * 1000,
  },
  rateLimit: {
    signup: { windowMs: 60 * 60 * 1000, max: 3 },
    login: { windowMs: 15 * 60 * 1000, max: 5 },
    passwordReset: { windowMs: 60 * 60 * 1000, max: 3 },
  },
  validation: {
    name: { min: 1, max: 100 },
    email: { max: 255 },
    password: { min: 8, max: 128 },
    phone: { max: 20 },
    city: { max: 100 },
    county: { max: 100 },
    statement: { max: 2000 },
  },
  email: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'FAIR Group <noreply@fairgroup.org>',
    adminEmail: process.env.ADMIN_EMAIL,
  },
  logging: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    directory: './logs',
    maxFiles: '14d',
    maxSize: '20m',
  },
  workingGroups: [
    'Criminal Code',
    'Prosecution',
    'Sentencing',
    'Community Supervision',
    'Police and Enforcement',
    'Incarceration and Rehabilitation',
  ],
};
