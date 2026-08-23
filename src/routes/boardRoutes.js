const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
	getRecentBoards,
	createNewBoard,
	getBoard,
	getSharedBoard,
	renameBoard,
	saveBoard,
	getShareLinks
} = require('../controller/boardController');

const router = express.Router();

router.get('/', authenticateToken, getRecentBoards);
router.post('/', authenticateToken, createNewBoard);
router.get('/share/:token', getSharedBoard);
router.get('/:boardId', authenticateToken, getBoard);
router.patch('/:boardId/title', authenticateToken, renameBoard);
router.put('/:boardId/content', authenticateToken, saveBoard);
router.get('/:boardId/share-links', authenticateToken, getShareLinks);

module.exports = router;
