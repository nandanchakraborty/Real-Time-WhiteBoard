// Passwords are stored as one-way hashes, never as plain text.
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

async function hashPassword(password) {
	return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, storedPassword) {
	return bcrypt.compare(password, storedPassword);
}

module.exports = { hashPassword, verifyPassword };
