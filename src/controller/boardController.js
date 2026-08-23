const {
	createBoard,
	ensureFirstBoard,
	listRecentBoards,
	findOwnedBoard,
	findBoardByShareToken,
	updateBoard
} = require('../services/boardService/boardservice');

function boardResponse(board) {
	return {
		id: board.id,
		title: board.title,
		content: board.content,
		pageCount: board.pageCount,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt
	};
}

async function getRecentBoards(req, res) {
	try {
		const firstBoard = await ensureFirstBoard(req.auth.userId);
		const boards = await listRecentBoards(req.auth.userId);
		return res.json({ activeBoardId: firstBoard.id, boards });
	} catch (error) {
		console.error('Unable to load boards:', error);
		return res.status(500).json({ error: 'Unable to load boards' });
	}
}

async function createNewBoard(req, res) {
	try {
		const board = await createBoard(req.auth.userId, req.body.title || 'Untitled board');
		return res.status(201).json({ board: boardResponse(board) });
	} catch (error) {
		console.error('Unable to create board:', error);
		return res.status(500).json({ error: 'Unable to create board' });
	}
}

async function getBoard(req, res) {
	try {
		const board = await findOwnedBoard(req.params.boardId, req.auth.userId);
		if (!board) return res.status(404).json({ error: 'Board not found' });
		return res.json({ board: boardResponse(board), permission: 'edit' });
	} catch (error) {
		console.error('Unable to load board:', error);
		return res.status(500).json({ error: 'Unable to load board' });
	}
}

async function getSharedBoard(req, res) {
	try {
		const board = await findBoardByShareToken(req.params.token);
		if (!board) return res.status(404).json({ error: 'Share link is invalid' });
		const permission = board.editToken === req.params.token ? 'edit' : 'view';
		return res.json({ board: boardResponse(board), permission });
	} catch (error) {
		console.error('Unable to load shared board:', error);
		return res.status(500).json({ error: 'Unable to load shared board' });
	}
}

async function renameBoard(req, res) {
	try {
		const board = await updateBoard(req.params.boardId, req.auth.userId, { title: req.body.title });
		return res.json({ board: boardResponse(board) });
	} catch (error) {
		console.error('Unable to rename board:', error);
		return res.status(500).json({ error: 'Unable to rename board' });
	}
}

async function saveBoard(req, res) {
	try {
		const board = await updateBoard(req.params.boardId, req.auth.userId, {
			content: req.body.content,
			pageCount: req.body.pageCount
		});
		return res.json({ board: boardResponse(board) });
	} catch (error) {
		console.error('Unable to save board:', error);
		return res.status(500).json({ error: 'Unable to save board' });
	}
}

async function getShareLinks(req, res) {
	try {
		const board = await findOwnedBoard(req.params.boardId, req.auth.userId);
		if (!board) return res.status(404).json({ error: 'Board not found' });
		const baseUrl = `${req.protocol}://${req.get('host')}/whiteboard/${board.id}`;
		return res.json({ editUrl: `${baseUrl}?share=${board.editToken}`, viewUrl: `${baseUrl}?share=${board.viewToken}` });
	} catch (error) {
		console.error('Unable to create share links:', error);
		return res.status(500).json({ error: 'Unable to create share links' });
	}
}

module.exports = { getRecentBoards, createNewBoard, getBoard, getSharedBoard, renameBoard, saveBoard, getShareLinks };
