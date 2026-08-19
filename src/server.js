const express = require('express');
const http = require('http');
const path = require('path');

const socketIo = require('socket.io');

const cors = require('cors');

const app = express();

const server = http.createServer(app);

const io = socketIo(server,{
    cors:{
        origin: "+",
        method:["GET","POST"]
    }
});

app.use(cors());
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

server.listen(PORT,'0.0.0.0',()=>{
    console.log(`Server is running on port ${PORT}`);

    console.log(`access form mobile :http://YOUR PC IP:${PORT}`);
})