const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
	getRecentBoards,
	createNewBoard,
	getBoard,
	getSharedBoard,
	renameBoard,
	saveBoard,
	getShareLinks,
	deleteBoard
} = require('../controller/boardController');

const router = express.Router();

// Board listing and creation belong to the logged-in account.
router.get('/', authenticateToken, getRecentBoards);
router.post('/', authenticateToken, createNewBoard);

// A share token identifies a board without exposing its owner's board list.
router.get('/share/:token', getSharedBoard);

// All board mutations and private reads require the owner's access token.
router.delete('/:boardId', authenticateToken, deleteBoard);
router.get('/:boardId', authenticateToken, getBoard);
router.patch('/:boardId/title', authenticateToken, renameBoard);
router.put('/:boardId/content', authenticateToken, saveBoard);
router.get('/:boardId/share-links', authenticateToken, getShareLinks);

module.exports = router;
