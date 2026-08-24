const express = require('express');
const http = require('http');
const path = require('path');

const socketIo = require('socket.io');

const cors = require('cors');
const { getPrismaClient } = require('./config/database');
const authRoutes = require('./routes/authRoutes/authroutes');
const boardRoutes = require('./routes/boardRoutes');
const { findOwnedBoard, findBoardByShareToken, updateBoard } = require('./services/boardService/boardservice');
const { updateBoardContent } = require('./services/boardService/boardservice');
const { verifyToken } = require('./utils/jwt');

const app = express();

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

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/boards', boardRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

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

const boardStates = new Map();

io.on('connection',(socket)=>{
    console.log('New client connected');
    let boardState = null;

    function emitState() {
        if (!boardState) return;
        socket.emit('drawing-history', boardState.lines);
        socket.emit('history-controls', { redoCount: boardState.redo.length });
        socket.emit('page-count', boardState.pageCount);
    }

    async function saveState() {
        await updateBoardContent(boardState.id, { lines: boardState.lines }, boardState.pageCount);
    }

    socket.on('join-board', async ({ boardId, accessToken, shareToken }) => {
        try {
            let board;
            let permission = 'view';
            if (shareToken) {
                board = await findBoardByShareToken(shareToken);
                permission = board && board.editToken === shareToken ? 'edit' : 'view';
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

    socket.on('draw', async (data) => {
        if (!boardState || socket.data.permission !== 'edit') return;
        boardState.lines.push(data);
        boardState.redo = [];
        await saveState();
        socket.to(boardState.id).emit('draw', data);
        io.to(boardState.id).emit('history-controls', { redoCount: 0 });
    });

    socket.on('undo', async () => {
        if (!boardState || socket.data.permission !== 'edit' || boardState.lines.length === 0) return;
        boardState.redo.push({ type: 'line', line: boardState.lines.pop() });
        await saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: boardState.redo.length });
    });

    socket.on('redo', async () => {
        if (!boardState || socket.data.permission !== 'edit' || boardState.redo.length === 0) return;
        const action = boardState.redo.pop();
        if (action.type === 'page-clear') boardState.lines.push(...action.lines);
        else boardState.lines.push(action.line || action);
        await saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: boardState.redo.length });
    });

    socket.on('clear-page', async () => {
        if (!boardState || socket.data.permission !== 'edit') return;
        const lines = boardState.lines.filter((line) => (line.pageId || 1) === boardState.pageCount);
        if (lines.length === 0) return;
        boardState.lines = boardState.lines.filter((line) => (line.pageId || 1) !== boardState.pageCount);
        boardState.redo = [{ type: 'page-clear', lines }];
        await saveState();
        io.to(boardState.id).emit('drawing-history', boardState.lines);
        io.to(boardState.id).emit('history-controls', { redoCount: 1 });
    });

    socket.on('add-page', async () => {
        if (!boardState || socket.data.permission !== 'edit') return;
        boardState.pageCount += 1;
        await saveState();
        io.to(boardState.id).emit('page-count', boardState.pageCount);
    });

    socket.on('disconnect',()=>{
        console.log('A client disconnected')
    });
});

// socket.emit()           // send to server
// socket.on()             // listen
// io.emit()               // send to all
// socket.broadcast.emit() // send to everyone except sender

const PORT = process.env.PORT || 3000;

async function startServer() {
    if (process.env.DATABASE_URL) {
        const prisma = getPrismaClient();
        await prisma.$connect();
        console.log('Connected to PostgreSQL');
    } else {
        console.log('DATABASE_URL is not configured; starting without PostgreSQL');
    }

    server.listen(PORT,'0.0.0.0',()=>{
        console.log(`Server is running on port ${PORT}`);
        console.log(`access form mobile :http://YOUR PC IP:${PORT}`);
    });
}

startServer().catch((error) => {
    console.error('Unable to connect to PostgreSQL:', error.message);
    process.exit(1);
});