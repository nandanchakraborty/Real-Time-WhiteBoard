const { getPrismaClient } = require('../../config/database');

// Services contain database operations so controllers can focus on HTTP responses.
async function createUser({ name, email, pass }) {
	const prisma = getPrismaClient();
	return prisma.user.create({
		data: { name, email, pass }
	});
}

async function findUserByEmail(email) {
	const prisma = getPrismaClient();
	return prisma.user.findUnique({ where: { email } });
}

async function findUserById(id) {
	const prisma = getPrismaClient();
	return prisma.user.findUnique({ where: { id } });
}

module.exports = { createUser, findUserByEmail, findUserById };
