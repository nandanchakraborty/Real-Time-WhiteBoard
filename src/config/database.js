require('dotenv').config();

let prisma;

function getPrismaClient() {
	if (!prisma) {
		const { PrismaClient } = require('@prisma/client');
		prisma = new PrismaClient();
	}

	return prisma;
}

module.exports = { getPrismaClient };
