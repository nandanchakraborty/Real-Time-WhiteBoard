require('dotenv').config();

// Reuse one Prisma client for the entire Node.js process.
// Creating a client per request would quickly exhaust database connections.
let prisma;

// Services call this function whenever they need to query or update the database.
function getPrismaClient() {
	if (!prisma) {
		const { PrismaClient } = require('@prisma/client');
		prisma = new PrismaClient();
	}

	return prisma;
}

async function connectDatabase() {
	// The server can still serve static files without a database, but API data needs one.
	if (!process.env.DATABASE_URL) {
		console.log('DATABASE_URL is not configured; starting without PostgreSQL');
		return null;
	}

	const client = getPrismaClient();
	await client.$connect();
	console.log('Connected to PostgreSQL');
	return client;
}

module.exports = { connectDatabase, getPrismaClient };
