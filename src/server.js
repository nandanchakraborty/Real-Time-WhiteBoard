const express = require('express');
const http = require('http');
const path = require('path');

const socketIo = require('socket.io');

const cors = require('cors');
const { connectDatabase } = require('./config/database');
const authRoutes = require('./routes/authRoutes/authroutes');
const boardRoutes = require('./routes/boardRoutes');
const { findOwnedBoard, findBoardByShareToken, updateBoard } = require('./services/boardService/boardservice');
const { updateBoardContent } = require('./services/boardService/boardservice');
const { verifyToken } = require('./utils/jwt');

// Express handles HTTP requests; Socket.IO uses the same HTTP server for live drawing.
const app = express();

// Allow one or more separately hosted frontend origins to call this API.
const allowedOrigins = process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
    : true;

const server = http.createServer(app);

const io = socketIo(server,{
    cors:{
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Parse JSON request bodies before the API routes receive them.
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// REST API groups: authentication and board data are kept under /api.
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);

// A small endpoint for deployment checks and uptime monitors.
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// These routes serve the included browser client. External clients can use only /api.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
});
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
});
app.get(['/whiteboard', '/whiteboard/:boardId'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Keep active boards in memory so all connected users see changes immediately.
// The database remains the durable source of truth when a board is reopened.
const boardStates = new Map();

io.on('connection',(socket)=>{
    console.log('New client connected');
    let boardState = null;

    // Send the current board to a client immediately after it joins a room.
    function emitState() {
        if (!boardState) return;
        socket.emit('drawing-history', boardState.lines);
        socket.emit('history-controls', { redoCount: boardState.redo.length });
        socket.emit('page-count', boardState.pageCount);
    }

    // Drawing can produce many events per second, so save once after the burst.
    // This prevents rapid strokes from exhausting PostgreSQL's connection pool.
    function saveState() {
        clearTimeout(boardState.saveTimer);
        boardState.saveTimer = setTimeout(async () => {
            try {
                await updateBoardContent(boardState.id, { lines: boardState.lines }, boardState.pageCount);
            } catch (error) {
                console.error('Unable to save board state:', error.message);
            }
        }, 250);
    }

    // A normal board requires its owner's access token. A share link can be viewed
    // anonymously, but an edit share requires a valid logged-in access token.
    socket.on('join-board', async ({ boardId, accessToken, shareToken }) => {
        try {
            let board;
            let permission = 'view';
            if (shareToken) {
                board = await findBoardByShareToken(shareToken);
                if (board && board.editToken === shareToken) {
                    try {
                        verifyToken(accessToken);
                        permission = 'edit';
                    } catch (error) {
                        permission = 'view';
                    }
                }
            } else {
                const payload = verifyToken(accessToken);
                board = await findOwnedBoard(boardId, payload.userId);
                permission = 'edit';
            }
            if (!board || board.id !== boardId) throw new Error('Board access denied');
                boardState = boardStates.get(board.id);
                if (!boardState) {
                    boardState = {
                        id: board.id,
                        userId: board.userId,
                        lines: Array.isArray(board.content?.lines) ? board.content.lines : [],
                        pageCount: board.pageCount,
                        redo: []
                    };
                    boardStates.set(board.id, boardState);
                }
            socket.join(board.id);
            socket.data.permission = permission;
            socket.emit('board-ready', { permission, title: board.title });
            emitState();
        } catch (error) {
            socket.emit('board-error', { error: 'Unable to open this board' });
        }
    });

    // Store a new line and broadcast it to everyone else in the same board room.
    socket.on('draw', async (data) => {
        if (!boardState || socket.data.permission !== 'edit') return;
        boardState.lines.push(data);
        boardState.redo = [];
        saveState();
        socket.to(boardState.id).emit('draw', data);
        io.to(boardState.id).emit('history-controls', { redoCount: 0 });
    });

    // Rename through Socket.IO so the owner and every connected editor update together.
    socket.on('rename-board', async ({ title }, callback) => {
        if (!boardState || socket.data.permission !== 'edit') {
            callback?.({ error: 'Board cannot be renamed' });
            return;
        }

        const nextTitle = typeof title === 'string' ? title.trim() : '';
        if (!nextTitle || nextTitle.length > 80) {
            callback?.({ error: 'Board name must be between 1 and 80 characters' });
            return;
        }

        try {
            const board = await updateBoard(boardState.id, boardState.userId, { title: nextTitle });
            if (!board) {
                callback?.({ error: 'Board not found' });
                return;
            }
            io.to(boardState.id).emit('board-title', board.title);
            callback?.({ ok: true, title: board.title });
        } catch (error) {
            console.error('Unable to rename board:', error);
            callback?.({ error: 'Unable to save board name' });
        }
    });

    // Undo removes the newest line and puts it on the redo stack.
    socket.on('undo', async () => {
        if (!boardState || socket.data.permission !== 'edit' || boardState.lines.length === 0) return;
        boardState.redo.push({ type: 'line', line: boardState.lines.pop() });
        saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: boardState.redo.length });
    });

    // Redo restores the most recently undone line or cleared page.
    socket.on('redo', async () => {
        if (!boardState || socket.data.permission !== 'edit' || boardState.redo.length === 0) return;
        const action = boardState.redo.pop();
        if (action.type === 'page-clear') boardState.lines.push(...action.lines);
        else boardState.lines.push(action.line || action);
        saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: boardState.redo.length });
    });

    // Clear only the currently selected page; undo can restore its removed lines.
    socket.on('clear-page', async () => {
        if (!boardState || socket.data.permission !== 'edit') return;
        const lines = boardState.lines.filter((line) => (line.pageId || 1) === boardState.pageCount);
        if (lines.length === 0) return;
        boardState.lines = boardState.lines.filter((line) => (line.pageId || 1) !== boardState.pageCount);
        boardState.redo = [{ type: 'page-clear', lines }];
        saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: 1 });
    });

    // Pages are represented by a count; lines carry their own pageId.
    socket.on('add-page', async () => {
        if (!boardState || socket.data.permission !== 'edit') return;
        boardState.pageCount += 1;
        saveState();
        io.to(boardState.id).emit('page-count', boardState.pageCount);
    });

    // Release the connection log when a browser closes or loses its socket.
    socket.on('disconnect',()=>{
        console.log('A client disconnected')
    });
});

// socket.emit()           // send to server
// socket.on()             // listen
// io.emit()               // send to all
// socket.broadcast.emit() // send to everyone except sender

const PORT = process.env.PORT || 3000;

// Connect to the database before accepting requests that need persisted data.
async function startServer() {
    await connectDatabase();

    server.listen(PORT,'0.0.0.0',()=>{
        console.log(`Server is running on port ${PORT}`);
        console.log(`access form mobile :http://YOUR PC IP:${PORT}`);
    });
}

startServer().catch((error) => {
    console.error('Unable to connect to PostgreSQL:', error.message);
    process.exit(1);
});