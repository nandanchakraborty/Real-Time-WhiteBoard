const API_BASE_URL = (window.WHITEBOARD_API_URL || '').replace(/\/$/, '');

// Use an empty base for the bundled client or a full URL for a separate frontend.
function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

async function restoreAuthSession() {
    // Refresh the access token before loading a private board or opening its socket.
    try {
        const response = await fetch(apiUrl('/api/auth/refresh'), {
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

const socket = typeof io === 'function'
    ? io(window.WHITEBOARD_API_URL || undefined, { autoConnect: false })
    : {
        connected: false,
        connect() {},
        emit() {},
        on() {}
    };

// The fallback keeps the canvas visible if the realtime library fails to load.
const pagesElement = document.getElementById('pages');
const status = document.getElementById('status');
const statusLabel = status.querySelector('.status-label');
const boardUrl = new URL(window.location.href);
const shareToken = boardUrl.searchParams.get('share');
let boardId = boardUrl.pathname.split('/').filter(Boolean)[1] || null;
let permission = 'view';
let pendingJoin = null;

let color = 'black';
let lineWidth = 5;
const eraserWidth = 20;
let erasing = false;
let drawing = false;
let drawingHistory = [];
let redoHistory = [];
let pageCount = 1;
let activeCanvas = null;
const undoButton = document.querySelector('[onclick="undo()"]');
const redoButton = document.querySelector('[onclick="redo()"]');
const boardTitleInput = document.getElementById('board-title');
const recentBoardsElement = document.getElementById('recent-boards');

function authHeaders() {
    // REST endpoints use the access token in the standard Bearer format.
    return { Authorization: `Bearer ${localStorage.getItem('whiteboardAccessToken')}` };
}

function formatBoardDate(value) {
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadRecentBoards() {
    // The sidebar shows only the owner's boards, never boards from a share link.
    if (shareToken) return;
    const response = await fetch(apiUrl('/api/boards'), { headers: authHeaders() });
    if (!response.ok) return;
    const result = await response.json();
    recentBoardsElement.innerHTML = result.boards.map((board) => {
        const isActive = board.id === boardId;
        return `
            <div class="recent-board-row">
                <a class="recent-board ${isActive ? 'is-active' : ''}" href="/whiteboard/${board.id}">
                    <span>${board.title}</span><small>${formatBoardDate(board.updatedAt)} · ${board.pageCount} page${board.pageCount === 1 ? '' : 's'}</small>
                </a>
                ${isActive ? '' : `<button class="delete-board" type="button" data-board-id="${board.id}" aria-label="Delete ${board.title}" title="Delete board">&times;</button>`}
            </div>
        `;
    }).join('');
    recentBoardsElement.querySelectorAll('.delete-board').forEach((button) => {
        button.addEventListener('click', () => deleteSavedBoard(button.dataset.boardId, button));
    });
}

async function deleteSavedBoard(savedBoardId, button) {
    // The active board is intentionally excluded from deletion in the rendered list.
    if (savedBoardId === boardId || !window.confirm('Delete this saved board? This cannot be undone.')) return;
    button.disabled = true;
    const response = await fetch(apiUrl(`/api/boards/${savedBoardId}`), {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (!response.ok) {
        button.disabled = false;
        return;
    }
    loadRecentBoards();
}

async function createNewBoard() {
    // The API creates the board; the response supplies its new URL id.
    const response = await fetch(apiUrl('/api/boards'), {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled board' })
    });
    if (response.ok) window.location.href = `/whiteboard/${(await response.json()).board.id}`;
}

async function renameCurrentBoard() {
    // Socket.IO broadcasts the saved title to the owner and other editors.
    const title = boardTitleInput.value.trim();
    if (!title || !boardId || permission !== 'edit') return;
    socket.emit('rename-board', { title }, (result) => {
        if (!result?.ok) {
            window.alert(result?.error || 'Unable to save board name');
        }
    });
}

async function copyShareLink(kind) {
    // The API creates both URLs; the client copies the selected one to the clipboard.
    if (!boardId || shareToken || permission !== 'edit') return;
    const response = await fetch(apiUrl(`/api/boards/${boardId}/share-links`), { headers: authHeaders() });
    if (!response.ok) return;
    const links = await response.json();
    await navigator.clipboard.writeText(kind === 'edit' ? links.editUrl : links.viewUrl);
}

function exportPdf() {
    const pdfConstructor = window.jspdf?.jsPDF;
    if (!pdfConstructor) return;
    const canvases = [...pagesElement.querySelectorAll('.board-page canvas')];
    if (!canvases.length) return;
    const first = canvases[0];
    const pdf = new pdfConstructor({ orientation: 'portrait', unit: 'px', format: [first.width, first.height] });
    canvases.forEach((canvas, index) => {
        if (index > 0) pdf.addPage([canvas.width, canvas.height], 'portrait');
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    });
    pdf.save(`${(boardTitleInput.value || 'whiteboard').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`);
}

document.getElementById('sidebar-toggle').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
document.getElementById('sidebar-collapse').addEventListener('click', () => document.body.classList.toggle('sidebar-collapsed'));
document.getElementById('new-board-button').addEventListener('click', createNewBoard);
document.getElementById('rename-board').addEventListener('click', renameCurrentBoard);
boardTitleInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        renameCurrentBoard();
    }
});
document.getElementById('share-edit').addEventListener('click', () => copyShareLink('edit'));
document.getElementById('share-view').addEventListener('click', () => copyShareLink('view'));
document.getElementById('export-pdf').addEventListener('click', exportPdf);
const boardSidebar = document.getElementById('board-sidebar');
boardSidebar.addEventListener('mouseenter', () => boardSidebar.classList.add('is-hovered'));
boardSidebar.addEventListener('mouseleave', () => boardSidebar.classList.remove('is-hovered'));
if (window.innerWidth > 800) document.body.classList.add('sidebar-collapsed');

async function loadBoard() {
    // Load initial data through REST, then join the same board through Socket.IO.
    const accessToken = localStorage.getItem('whiteboardAccessToken');
    let boardResult;

    if (!boardId) {
        if (!accessToken) {
            window.location.href = '/auth';
            return;
        }
        const response = await fetch(apiUrl('/api/boards'), {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error('Unable to load your boards');
        const result = await response.json();
        boardId = result.activeBoardId;
        window.location.replace(`/whiteboard/${boardId}`);
        return;
    }

    if (shareToken) {
        const response = await fetch(apiUrl(`/api/boards/share/${shareToken}`), {
            headers: authHeaders()
        });
        if (!response.ok) throw new Error('This share link is invalid');
        boardResult = await response.json();
    } else {
        if (!accessToken) {
            window.location.href = '/auth';
            return;
        }
        const response = await fetch(apiUrl(`/api/boards/${boardId}`), {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error('Unable to open this board');
        boardResult = await response.json();
    }

    permission = boardResult.permission;
    boardTitleInput.value = boardResult.board.title;
    drawingHistory = (boardResult.board.content?.lines || []).map((line) => ({ pageId: line.pageId || 1, ...line }));
    pageCount = boardResult.board.pageCount || 1;
    ensurePages(pageCount);
    pagesElement.querySelectorAll('canvas').forEach(redrawHistory);
    if (permission === 'view') {
        document.querySelectorAll('.tool-action, .segmented-control button, .swatch').forEach((button) => {
            button.disabled = true;
        });
        document.getElementById('rename-board').disabled = true;
        document.getElementById('share-edit').disabled = true;
        document.getElementById('share-view').disabled = true;
    }
    pendingJoin = { boardId, accessToken, shareToken };
    if (!socket.connected) socket.connect();
    else socket.emit('join-board', pendingJoin);
    loadRecentBoards();
}

function getPageCanvas(pageId) {
    const page = pagesElement.querySelector(`[data-page-id="${pageId}"]`);
    return page ? page.querySelector('canvas') : null;
}

function drawPageLabel(page, pageId) {
    page.querySelector('.page-number').textContent = `Page ${pageId}`;
}

function createPage(pageId) {
    if (getPageCanvas(pageId)) {
        return;
    }

    const page = document.createElement('section');
    page.className = 'board-page';
    page.dataset.pageId = pageId;
    page.innerHTML = `<span class="page-number"></span><canvas aria-label="Whiteboard page ${pageId}"></canvas>`;
    pagesElement.appendChild(page);
    drawPageLabel(page, pageId);
    const pageCanvas = page.querySelector('canvas');
    pageCanvas.addEventListener('pointerdown', (event) => startDrawing(event, pageCanvas));
    pageCanvas.addEventListener('pointermove', (event) => continueDrawing(event, pageCanvas));
    pageCanvas.addEventListener('pointerup', stopDrawing);
    pageCanvas.addEventListener('pointercancel', stopDrawing);
    pageCanvas.addEventListener('pointerleave', stopDrawing);
    resizeCanvas(pageCanvas);
}

function ensurePages(count) {
    pageCount = Math.max(pageCount, count);
    for (let pageId = 1; pageId <= pageCount; pageId += 1) {
        createPage(pageId);
    }
}

function resizeCanvas(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawHistory(canvas);
}

function drawLine(line) {
    // Coordinates are stored as ratios so drawings resize correctly on different screens.
    const canvas = getPageCanvas(line.pageId || 1);
    if (!canvas) {
        return;
    }
    const context = canvas.getContext('2d');
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

function redrawHistory(canvas) {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawingHistory.filter((line) => line.pageId === Number(canvas.closest('.board-page').dataset.pageId)).forEach(drawLine);
}

function getPoint(event, canvas) {
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
    // These commands are handled by the server so every connected editor stays synced.
    socket.emit('clear-page');
}

function addPage() {
    socket.emit('add-page');
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

function startDrawing(event, canvas) {
    // View-only users must not even draw locally; the server also checks this permission.
    if (permission !== 'edit') {
        return;
    }
    drawing = true;
    activeCanvas = canvas;
    canvas.setPointerCapture(event.pointerId);
    canvas.lastPoint = getPoint(event, canvas);
}

function continueDrawing(event, canvas) {
    if (permission !== 'edit' || !drawing || activeCanvas !== canvas) {
        return;
    }

    const point = getPoint(event, canvas);
    const line = {
        pageId: Number(canvas.closest('.board-page').dataset.pageId),
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
}

function stopDrawing() {
    drawing = false;
    if (activeCanvas) {
        activeCanvas.lastPoint = null;
    }
    activeCanvas = null;
}

socket.on('connect', () => {
    statusLabel.textContent = 'Connected';
    status.classList.add('connected');
    if (pendingJoin) socket.emit('join-board', pendingJoin);
});

socket.on('disconnect', () => {
    statusLabel.textContent = 'Disconnected';
    status.classList.remove('connected');
});

socket.on('board-title', (title) => {
    boardTitleInput.value = title;
    loadRecentBoards();
});

socket.on('drawing-history', (history) => {
    // A full history replaces local state after joining, undoing, redoing, or clearing.
    drawingHistory = history.map((line) => ({ pageId: line.pageId || 1, ...line }));
    ensurePages(drawingHistory.reduce((highest, line) => Math.max(highest, line.pageId), 1));
    pagesElement.querySelectorAll('canvas').forEach(redrawHistory);
    updateHistoryControls();
});

socket.on('page-count', (count) => {
    ensurePages(count);
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

ensurePages(pageCount);
window.addEventListener('resize', () => pagesElement.querySelectorAll('canvas').forEach(resizeCanvas));
(async function initializeBoard() {
    await restoreAuthSession();
    await loadBoard();
})().catch((error) => {
    statusLabel.textContent = error.message;
    status.classList.remove('connected');
});
