const express = require('express');
const http = require('http');
const path = require('path');

const socketIo = require('socket.io');

const cors = require('cors');
const { getPrismaClient } = require('./config/database');
const authRoutes = require('./routes/authRoutes/authroutes');

const app = express();

const server = http.createServer(app);

const io = socketIo(server,{
    cors:{
        origin: "+",
        method:["GET","POST"]
    }
});

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
});
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'auth.html'));
});
app.get('/whiteboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

let drawingHistory = [];
let redoHistory = [];

function broadcastHistory() {
    io.emit('drawing-history', drawingHistory);
    io.emit('history-controls', { redoCount: redoHistory.length });
}

io.on('connection',(socket)=>{
    console.log('New client connected');

    socket.emit('drawing-history', drawingHistory);
    socket.emit('history-controls', { redoCount: redoHistory.length });


    socket.on('draw',(data)=>{
        drawingHistory.push(data);
        redoHistory = [];
        socket.broadcast.emit('draw',data);
        io.emit('history-controls', { redoCount: 0 });
    });

    socket.on('undo', () => {
        if (drawingHistory.length === 0) {
            return;
        }

        redoHistory.push(drawingHistory.pop());
        broadcastHistory();
    });

    socket.on('redo', () => {
        if (redoHistory.length === 0) {
            return;
        }

        drawingHistory.push(redoHistory.pop());
        broadcastHistory();
    });

    socket.on('clear',()=>{
        drawingHistory = [];
        redoHistory = [];
        io.emit('clear');
        io.emit('history-controls', { redoCount: 0 });
    })

    socket.on('disconnet',()=>{
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