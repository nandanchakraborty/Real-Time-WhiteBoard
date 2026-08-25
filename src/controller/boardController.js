const {
	createBoard,
	ensureFirstBoard,
	listRecentBoards,
	findOwnedBoard,
	findBoardByShareToken,
	updateBoard,
	deleteOwnedBoard
} = require('../services/boardService/boardservice');
const { verifyToken } = require('../utils/jwt');

// Keep API responses consistent and avoid exposing share tokens in normal board data.
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
	// Ensure every account has a destination board before returning the list.
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
	// View tokens work anonymously; edit tokens require a valid access token.
	try {
		const board = await findBoardByShareToken(req.params.token);
		if (!board) return res.status(404).json({ error: 'Share link is invalid' });
		let permission = 'view';
		if (board.editToken === req.params.token) {
			try {
				verifyToken(req.headers.authorization?.split(' ')[1]);
				permission = 'edit';
			} catch (error) {
				permission = 'view';
			}
		}
		return res.json({ board: boardResponse(board), permission });
	} catch (error) {
		console.error('Unable to load shared board:', error);
		return res.status(500).json({ error: 'Unable to load shared board' });
	}
}

async function renameBoard(req, res) {
	try {
		const board = await updateBoard(req.params.boardId, req.auth.userId, { title: req.body.title });
		if (!board) return res.status(404).json({ error: 'Board not found' });
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
		if (!board) return res.status(404).json({ error: 'Board not found' });
		return res.json({ board: boardResponse(board) });
	} catch (error) {
		console.error('Unable to save board:', error);
		return res.status(500).json({ error: 'Unable to save board' });
	}
}

async function getShareLinks(req, res) {
	// Only the owner can request links, because these URLs grant board access.
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

async function deleteBoard(req, res) {
	try {
		const deleted = await deleteOwnedBoard(req.params.boardId, req.auth.userId);
		if (!deleted) return res.status(404).json({ error: 'Board not found' });
		return res.json({ message: 'Board deleted successfully' });
	} catch (error) {
		console.error('Unable to delete board:', error);
		return res.status(500).json({ error: 'Unable to delete board' });
	}
}

module.exports = { getRecentBoards, createNewBoard, getBoard, getSharedBoard, renameBoard, saveBoard, getShareLinks, deleteBoard };
