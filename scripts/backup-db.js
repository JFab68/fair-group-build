const fs = require('fs');
const path = require('path');
const config = require('../config');

const dbPath = path.resolve(config.database.path);
const backupDir = path.join(path.dirname(dbPath), 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `database-${timestamp}.sqlite`);

if (!fs.existsSync(dbPath)) {
  console.error('Database file not found:', dbPath);
  process.exit(1);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

fs.copyFileSync(dbPath, backupPath);
console.log(`Database backed up to: ${backupPath}`);
