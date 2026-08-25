const crypto = require('crypto');
const { getPrismaClient } = require('../../config/database');

function createShareToken() {
	// Share tokens are random, unguessable identifiers for view/edit URLs.
	return crypto.randomBytes(24).toString('hex');
}

function emptyContent() {
	return { lines: [] };
}

async function createBoard(userId, title = 'Untitled board') {
	// New boards start with one empty page and separate view/edit tokens.
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
	// The whiteboard route needs a board even for a brand-new account.
	const prisma = getPrismaClient();
	const board = await prisma.board.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
	return board || createBoard(userId);
}

async function listRecentBoards(userId, take = 5) {
	// Limit the sidebar list so it stays quick and easy to scan.
	const prisma = getPrismaClient();
	return prisma.board.findMany({
		where: { userId },
		orderBy: { updatedAt: 'desc' },
		take,
		select: { id: true, title: true, updatedAt: true, pageCount: true }
	});
}

async function findOwnedBoard(id, userId) {
	// Always include userId to prevent one account reading another account's board.
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
	// Check ownership first, then update by the board's unique id.
	const prisma = getPrismaClient();
	const board = await prisma.board.findFirst({ where: { id, userId } });
	if (!board) return null;
	return prisma.board.update({ where: { id }, data });
}

async function updateBoardContent(id, content, pageCount) {
	// Realtime drawing uses this smaller operation to persist the current snapshot.
	const prisma = getPrismaClient();
	return prisma.board.update({ where: { id }, data: { content, pageCount } });
}

async function deleteOwnedBoard(id, userId) {
	// deleteMany lets us enforce ownership and learn whether anything was deleted.
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
