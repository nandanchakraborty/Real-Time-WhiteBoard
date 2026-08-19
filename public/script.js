const socket = io();
const canvas = document.getElementById('whiteboard');
const context = canvas.getContext('2d');
const status = document.getElementById('status');

let color = 'black';
let lineWidth = 5;
let erasing = false;
let drawing = false;
let drawingHistory = [];

function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawHistory();
}

function drawLine(line) {
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    context.strokeStyle = line.color;
    context.lineWidth = line.lineWidth;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(line.startX * canvasWidth, line.startY * canvasHeight);
    context.lineTo(line.endX * canvasWidth, line.endY * canvasHeight);
    context.stroke();
}

function redrawHistory() {
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawingHistory.forEach(drawLine);
}

function getPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height
    };
}

function setColor(selectedColor) {
    color = selectedColor;
    erasing = false;
}

function setLineWidth(selectedWidth) {
    lineWidth = selectedWidth;
}

function toggleEraser() {
    erasing = !erasing;
}

function clearBoard() {
    socket.emit('clear');
}

canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    canvas.lastPoint = getPoint(event);
});

canvas.addEventListener('pointermove', (event) => {
    if (!drawing) {
        return;
    }

    const point = getPoint(event);
    const line = {
        startX: canvas.lastPoint.x,
        startY: canvas.lastPoint.y,
        endX: point.x,
        endY: point.y,
        color: erasing ? 'white' : color,
        lineWidth
    };

    drawingHistory.push(line);
    drawLine(line);
    socket.emit('draw', line);
    canvas.lastPoint = point;
});

function stopDrawing() {
    drawing = false;
    canvas.lastPoint = null;
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);

socket.on('connect', () => {
    status.textContent = 'Connected ! share this url with other devices';
    status.classList.add('connected');
});

socket.on('disconnect', () => {
    status.textContent = 'Disconnected from server';
    status.classList.remove('connected');
});

socket.on('drawing-history', (history) => {
    drawingHistory = history;
    redrawHistory();
});

socket.on('draw', (line) => {
    drawingHistory.push(line);
    drawLine(line);
});

socket.on('clear', () => {
    drawingHistory = [];
    redrawHistory();
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
