const crypto = require('crypto');
const { getPrismaClient } = require('../../config/database');

function createShareToken() {
	return crypto.randomBytes(24).toString('hex');
}

function emptyContent() {
	return { lines: [] };
}

async function createBoard(userId, title = 'Untitled board') {
	const prisma = getPrismaClient();
	return prisma.board.create({
		data: {
			userId,
			title,
			content: emptyContent(),
			pageCount: 1,
			editToken: createShareToken(),
			viewToken: createShareToken()
		}
	});
}

async function ensureFirstBoard(userId) {
	const prisma = getPrismaClient();
	const board = await prisma.board.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
	return board || createBoard(userId);
}

async function listRecentBoards(userId, take = 5) {
	const prisma = getPrismaClient();
	return prisma.board.findMany({
		where: { userId },
		orderBy: { updatedAt: 'desc' },
		take,
		select: { id: true, title: true, updatedAt: true, pageCount: true }
	});
}

async function findOwnedBoard(id, userId) {
	const prisma = getPrismaClient();
	return prisma.board.findFirst({ where: { id, userId } });
}

async function findBoardByShareToken(token) {
	if (!token) return null;
	const prisma = getPrismaClient();
	return prisma.board.findFirst({
		where: { OR: [{ editToken: token }, { viewToken: token }] }
	});
}

async function updateBoard(id, userId, data) {
	const prisma = getPrismaClient();
	const board = await prisma.board.findFirst({ where: { id, userId } });
	if (!board) return null;
	return prisma.board.update({ where: { id }, data });
}

async function updateBoardContent(id, content, pageCount) {
	const prisma = getPrismaClient();
	return prisma.board.update({ where: { id }, data: { content, pageCount } });
}

async function deleteOwnedBoard(id, userId) {
	const prisma = getPrismaClient();
	const result = await prisma.board.deleteMany({ where: { id, userId } });
	return result.count > 0;
}

module.exports = {
	createBoard,
	ensureFirstBoard,
	listRecentBoards,
	findOwnedBoard,
	findBoardByShareToken,
	updateBoard,
	updateBoardContent,
	deleteOwnedBoard
};
