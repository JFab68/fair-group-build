const readline = require('readline');
const bcrypt = require('bcrypt');
const db = require('../database');
const config = require('../config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  db.initialize();

  console.log('\n--- Create Admin User ---\n');

  const firstName = await ask('First name: ');
  const lastName = await ask('Last name: ');
  const email = await ask('Email: ');
  const password = await ask('Password: ');

  const existing = db.findUserByEmail(email);
  if (existing) {
    console.log('A user with this email already exists.');
    rl.close();
    db.close();
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, config.security.bcryptRounds);

  const userId = db.createUser({
    firstName, lastName, email, password: hashedPassword,
    phone: '', city: '', county: '', interestAreas: '', hearAboutUs: '', statement: '',
  });

  db.updateUserStatus(userId, 'approved');
  db.updateUserRole(userId, 'admin');

  console.log(`\nAdmin user created successfully (ID: ${userId})`);

  rl.close();
  db.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
