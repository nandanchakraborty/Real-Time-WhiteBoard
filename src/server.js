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

io.on('connection',(socket)=>{
    console.log('New client connected');

    socket.emit('drawing-history',drawingHistory);


    socket.on('draw',(data)=>{
        drawingHistory.push(data);
        socket.broadcast.emit('draw',data);
    });

    socket.on('clear',()=>{
        drawingHistory = [];
        io.emit('clear')
    })

    socket.on('disconnet',()=>{
        console.log('A client disconnected')
    });
});

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