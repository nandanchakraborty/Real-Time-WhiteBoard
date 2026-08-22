async function restoreAuthSession() {
    try {
        const response = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            return;
        }

        const result = await response.json();
        localStorage.setItem('whiteboardAccessToken', result.accessToken);
        localStorage.setItem('whiteboardUser', JSON.stringify(result.user));
    } catch (error) {
        console.error('Unable to restore auth session:', error);
    }
}

restoreAuthSession();

const socket = io();
const canvas = document.getElementById('whiteboard');
const context = canvas.getContext('2d');
const status = document.getElementById('status');
const statusLabel = status.querySelector('.status-label');

let color = 'black';
let lineWidth = 5;
const eraserWidth = 20;
let erasing = false;
let drawing = false;
let drawingHistory = [];
let redoHistory = [];
const undoButton = document.querySelector('[onclick="undo()"]');
const redoButton = document.querySelector('[onclick="redo()"]');

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
    document.querySelectorAll('.swatch').forEach((swatch) => {
        swatch.classList.toggle('is-active', swatch.dataset.color === selectedColor);
    });
}

function setLineWidth(selectedWidth) {
    lineWidth = selectedWidth;
    document.querySelectorAll('[data-width]').forEach((button) => {
        button.classList.toggle('is-active', Number(button.dataset.width) === selectedWidth);
    });
}

function toggleEraser() {
    erasing = !erasing;
}

function clearBoard() {
    socket.emit('clear');
}

function undo() {
    socket.emit('undo');
}

function redo() {
    socket.emit('redo');
}

function updateHistoryControls() {
    undoButton.disabled = drawingHistory.length === 0;
    redoButton.disabled = redoHistory.length === 0;
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
        lineWidth: erasing ? eraserWidth : lineWidth
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
    statusLabel.textContent = 'Connected';
    status.classList.add('connected');
});

socket.on('disconnect', () => {
    statusLabel.textContent = 'Disconnected';
    status.classList.remove('connected');
});

socket.on('drawing-history', (history) => {
    drawingHistory = history;
    redrawHistory();
    updateHistoryControls();
});

socket.on('history-controls', ({ redoCount }) => {
    redoHistory.length = redoCount;
    updateHistoryControls();
});

socket.on('draw', (line) => {
    drawingHistory.push(line);
    drawLine(line);
    updateHistoryControls();
});

socket.on('clear', () => {
    drawingHistory = [];
    redoHistory = [];
    redrawHistory();
    updateHistoryControls();
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
