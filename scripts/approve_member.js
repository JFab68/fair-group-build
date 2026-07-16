const db = require('../database');
const config = require('../config');

async function cli() {
  const email = process.argv[2];
  const action = process.argv[3] || 'approve';
  if (!email) {
    console.log('Usage: node scripts/approve_member.js <email> [approve|reject]');
    process.exit(1);
  }
  db.initialize();
  const user = db.findUserByEmail(email);
  if (!user) {
    console.log('User not found:', email);
    process.exit(1);
  }

  const status = action === 'reject' ? 'rejected' : 'approved';
  db.updateUserStatus(user.id, status);
  console.log(`Updated ${user.email} -> ${status}`);
}

cli();
