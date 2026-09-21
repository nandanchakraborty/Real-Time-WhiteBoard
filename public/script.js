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
let shapeMode = null;
let shapeDrawing = false;
let activeShape = null;
let selectedShapeIndex = null;
let selectedShapePageId = null;
let shapeInteraction = null;
let textMode = false;
let textFontSize = 16;
let selectedTextIndex = null;
let selectedTextPageId = null;
let draggingText = false;
let textDragOffset = { x: 0, y: 0 };
let drawingHistory = [];
let redoHistory = [];
let pageCount = 1;
let lastEditedPageId = 1;
let activeCanvas = null;
const undoButton = document.querySelector('[onclick="undo()"]');
const redoButton = document.querySelector('[onclick="redo()"]');
const boardTitleInput = document.getElementById('board-title');
const recentBoardsElement = document.getElementById('recent-boards');
const textToolButton = document.getElementById('text-tool-button');
const shapeToolButtons = document.querySelectorAll('.shape-tool');

function authHeaders() {
    // REST endpoints use the access token in the standard Bearer format.
    return { Authorization: `Bearer ${localStorage.getItem('whiteboardAccessToken')}` };
}

function redirectToAuth() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/auth?returnTo=${encodeURIComponent(returnTo)}`;
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
    const exportButton = document.getElementById('export-pdf');
    const pdfConstructor = window.jspdf?.jsPDF;
    const canvases = [...pagesElement.querySelectorAll('.board-page canvas')];
    if (!pdfConstructor || !canvases.length) {
        window.alert('The board is not ready to export yet. Please try again.');
        return;
    }

    exportButton.disabled = true;
    try {
        const first = canvases[0];
        const pdf = new pdfConstructor({
            orientation: first.width > first.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [first.width, first.height]
        });
        canvases.forEach((canvas, index) => {
            const width = canvas.width;
            const height = canvas.height;
            if (index > 0) {
                pdf.addPage([width, height], width > height ? 'landscape' : 'portrait');
            }
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height);
        });
        const filename = (boardTitleInput.value || 'whiteboard')
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase() || 'whiteboard';
        pdf.save(`${filename}.pdf`);
    } catch (error) {
        console.error('Unable to export whiteboard as PDF:', error);
        window.alert('Unable to export the board as PDF. Please try again.');
    } finally {
        exportButton.disabled = false;
    }
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
shapeToolButtons.forEach((button) => {
    button.addEventListener('click', () => setShape(button.dataset.shape));
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // Only trigger shortcuts when not typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
    }
    
    if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        toggleTextTool();
    }
});

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
        if (response.status === 401) {
            redirectToAuth();
            return;
        }
        if (!response.ok) throw new Error('This share link is invalid');
        boardResult = await response.json();
    } else {
        if (!accessToken) {
            redirectToAuth();
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
    lastEditedPageId = drawingHistory.at(-1)?.pageId || 1;
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
        shapeToolButtons.forEach((button) => {
            button.disabled = true;
        });
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
    pageCanvas.addEventListener('pointerdown', (event) => {
        if (!textMode) {
            const shapeIndex = getShapeAtPoint(event, pageCanvas);
            if (shapeIndex !== null) {
                startShapeInteraction(event, pageCanvas, shapeIndex);
                return;
            }
        }
        if (shapeMode) {
            startShape(event, pageCanvas);
            return;
        }
        if (textMode) {
            // In text mode, check if clicking on existing text for selection/move
            const point = getPoint(event, pageCanvas);
            const pageId = Number(pageCanvas.closest('.board-page').dataset.pageId);
            const textIndex = getTextAtPoint(point, pageId);
            
            console.log(`[pointerdown] textMode=true, textIndex=${textIndex}`);
            
            if (textIndex !== null && permission === 'edit') {
                console.log(`[pointerdown] selecting text at index ${textIndex}`);
                event.preventDefault();
                selectedTextIndex = textIndex;
                selectedTextPageId = pageId;
                draggingText = true;
                pageCanvas.setPointerCapture(event.pointerId);
                textDragOffset.x = point.x - drawingHistory[textIndex].x;
                textDragOffset.y = point.y - drawingHistory[textIndex].y;
                redrawHistory(pageCanvas);
                return;
            }
        }
        startDrawing(event, pageCanvas);
    });
    
    pageCanvas.addEventListener('pointermove', (event) => {
        if (shapeInteraction && activeCanvas === pageCanvas) {
            updateShapeInteraction(event, pageCanvas);
            return;
        }
        if (shapeDrawing && activeCanvas === pageCanvas) {
            updateShape(event, pageCanvas);
            return;
        }
        if (draggingText && selectedTextIndex !== null) {
            const point = getPoint(event, pageCanvas);
            const textObj = drawingHistory[selectedTextIndex];
            textObj.x = point.x - textDragOffset.x;
            textObj.y = point.y - textDragOffset.y;
            
            // Clamp to canvas bounds
            textObj.x = Math.max(0, Math.min(1, textObj.x));
            textObj.y = Math.max(0, Math.min(1, textObj.y));
            
            redrawHistory(pageCanvas);
            return;
        }
        continueDrawing(event, pageCanvas);
    });
    
    pageCanvas.addEventListener('pointerup', (event) => {
        if (shapeInteraction && activeCanvas === pageCanvas) {
            finishShapeInteraction(event, pageCanvas);
            return;
        }
        if (shapeDrawing && activeCanvas === pageCanvas) {
            finishShape(event, pageCanvas);
            return;
        }
        if (draggingText && selectedTextIndex !== null) {
            draggingText = false;
            const textObj = drawingHistory[selectedTextIndex];
            socket.emit('move-text', {
                index: selectedTextIndex,
                x: textObj.x,
                y: textObj.y,
                pageId: selectedTextPageId
            });
            try {
                pageCanvas.releasePointerCapture(event.pointerId);
            } catch (e) {
                // Pointer capture might already be released
            }
            redrawHistory(pageCanvas);
            return;
        }
        stopDrawing();
    });
    
    pageCanvas.addEventListener('pointercancel', cancelShapeOrDrawing);
    pageCanvas.addEventListener('pointerleave', () => {
        if (!shapeDrawing && !shapeInteraction) {
            stopDrawing();
        }
    });
    pageCanvas.addEventListener('click', (event) => {
        if (permission !== 'edit' || draggingText) {
            return;
        }

        const point = getPoint(event, pageCanvas);
        const pageId = Number(pageCanvas.closest('.board-page').dataset.pageId);
        const textIndex = getTextAtPoint(point, pageId);

        if (textIndex !== null) {
            const textObj = drawingHistory[textIndex];
            if (textObj && textObj.type === 'text') {
                openTextEditor({
                    canvas: pageCanvas,
                    pageId,
                    point: { x: textObj.x, y: textObj.y },
                    initialValue: textObj.text,
                    existingTextIndex: textIndex,
                    clickPosition: { clientX: event.clientX, clientY: event.clientY }
                });
            }
            return;
        }

        if (textMode) {
            handleTextInputClick(event, pageCanvas);
        }
    });
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
    const pageId = Number(canvas.closest('.board-page').dataset.pageId);
    drawingHistory
        .filter((item) => item.pageId === pageId)
        .forEach((item, displayIndex) => {
            if (item.type === 'text') {
                const historyIndex = drawingHistory.indexOf(item);
                const isSelected = selectedTextIndex === historyIndex && selectedTextPageId === pageId;
                drawTextWithSelection(item, displayIndex, pageId, isSelected);
            } else if (item.type === 'shape') {
                drawShape(item);
                const historyIndex = drawingHistory.indexOf(item);
                if (selectedShapeIndex === historyIndex && selectedShapePageId === pageId) {
                    drawShapeSelection(item, canvas);
                }
            } else {
                drawLine(item);
            }
        });
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

function toggleTextTool() {
    if (permission !== 'edit') {
        return;
    }
    textMode = !textMode;
    if (textMode) {
        shapeMode = null;
        shapeToolButtons.forEach((button) => {
            button.classList.remove('is-active');
        });
    }
    textToolButton.classList.toggle('is-active', textMode);
    document.body.style.cursor = textMode ? 'text' : 'auto';
}

function setShape(nextShape) {
    if (permission !== 'edit') {
        return;
    }
    shapeMode = shapeMode === nextShape ? null : nextShape;
    textMode = false;
    textToolButton.classList.remove('is-active');
    shapeToolButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.shape === shapeMode);
    });
    document.body.style.cursor = shapeMode ? 'crosshair' : 'auto';
}

function drawShape(shape) {
    const canvas = getPageCanvas(shape.pageId || 1);
    if (!canvas) {
        return;
    }
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const startX = shape.startX * width;
    const startY = shape.startY * height;
    const endX = shape.endX * width;
    const endY = shape.endY * height;
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const shapeWidth = Math.abs(endX - startX);
    const shapeHeight = Math.abs(endY - startY);
    const shapeSize = Math.min(shapeWidth, shapeHeight);

    context.strokeStyle = shape.color || color;
    context.lineWidth = shape.lineWidth || lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (shape.shape === 'circle') {
        context.arc(left + shapeWidth / 2, top + shapeHeight / 2, shapeSize / 2, 0, Math.PI * 2);
    } else if (shape.shape === 'triangle') {
        context.moveTo(left + shapeWidth / 2, top);
        context.lineTo(left + shapeWidth, top + shapeHeight);
        context.lineTo(left, top + shapeHeight);
        context.closePath();
    } else if (shape.shape === 'arrow') {
        const angle = Math.atan2(endY - startY, endX - startX);
        const headLength = Math.max(12, (shape.lineWidth || lineWidth) * 3);
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.moveTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
        context.moveTo(endX, endY);
        context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
    } else {
        context.rect(left + (shapeWidth - shapeSize) / 2, top + (shapeHeight - shapeSize) / 2, shapeSize, shapeSize);
    }
    context.stroke();
}

function getShapeBounds(shape) {
    return {
        left: Math.min(shape.startX, shape.endX),
        top: Math.min(shape.startY, shape.endY),
        right: Math.max(shape.startX, shape.endX),
        bottom: Math.max(shape.startY, shape.endY)
    };
}

function getShapeAtPoint(event, canvas) {
    const point = getPoint(event, canvas);
    const paddingX = 12 / canvas.clientWidth;
    const paddingY = 12 / canvas.clientHeight;
    const pageId = Number(canvas.closest('.board-page').dataset.pageId);
    for (let index = drawingHistory.length - 1; index >= 0; index -= 1) {
        const shape = drawingHistory[index];
        if (shape.type !== 'shape' || (shape.pageId || 1) !== pageId) {
            continue;
        }
        const bounds = getShapeBounds(shape);
        if (point.x >= bounds.left - paddingX && point.x <= bounds.right + paddingX && point.y >= bounds.top - paddingY && point.y <= bounds.bottom + paddingY) {
            return index;
        }
    }
    return null;
}

function getShapeHandleAtPoint(shape, point, canvas) {
    if (selectedShapeIndex === null) {
        return null;
    }
    const bounds = getShapeBounds(shape);
    const handleX = 14 / canvas.clientWidth;
    const handleY = 14 / canvas.clientHeight;
    const handles = {
        nw: [bounds.left, bounds.top],
        n: [(bounds.left + bounds.right) / 2, bounds.top],
        ne: [bounds.right, bounds.top],
        e: [bounds.right, (bounds.top + bounds.bottom) / 2],
        se: [bounds.right, bounds.bottom],
        s: [(bounds.left + bounds.right) / 2, bounds.bottom],
        sw: [bounds.left, bounds.bottom],
        w: [bounds.left, (bounds.top + bounds.bottom) / 2]
    };
    return Object.entries(handles).find(([, position]) => Math.abs(point.x - position[0]) <= handleX && Math.abs(point.y - position[1]) <= handleY)?.[0] || null;
}

function drawShapeSelection(shape, canvas) {
    const context = canvas.getContext('2d');
    const bounds = getShapeBounds(shape);
    const left = bounds.left * canvas.clientWidth;
    const top = bounds.top * canvas.clientHeight;
    const width = (bounds.right - bounds.left) * canvas.clientWidth;
    const height = (bounds.bottom - bounds.top) * canvas.clientHeight;
    const handles = [
        [left, top], [left + width / 2, top], [left + width, top],
        [left + width, top + height / 2], [left + width, top + height],
        [left + width / 2, top + height], [left, top + height], [left, top + height / 2]
    ];
    context.save();
    context.strokeStyle = '#5b87ad';
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.strokeRect(left, top, width, height);
    context.setLineDash([]);
    context.fillStyle = '#fffdf8';
    context.strokeStyle = '#5b87ad';
    handles.forEach(([x, y]) => {
        context.fillRect(x - 4, y - 4, 8, 8);
        context.strokeRect(x - 4, y - 4, 8, 8);
    });
    context.restore();
}

function startShapeInteraction(event, canvas, index) {
    if (permission !== 'edit') {
        return;
    }
    const point = getPoint(event, canvas);
    const shape = drawingHistory[index];
    selectedShapeIndex = index;
    selectedShapePageId = shape.pageId || 1;
    shapeInteraction = {
        index,
        handle: getShapeHandleAtPoint(shape, point, canvas),
        startPoint: point,
        original: { ...shape }
    };
    activeCanvas = canvas;
    canvas.setPointerCapture(event.pointerId);
    redrawHistory(canvas);
}

function updateShapeInteraction(event, canvas) {
    const interaction = shapeInteraction;
    const shape = drawingHistory[interaction.index];
    const point = getPoint(event, canvas);
    if (!shape) {
        return;
    }
    if (!interaction.handle) {
        const deltaX = point.x - interaction.startPoint.x;
        const deltaY = point.y - interaction.startPoint.y;
        const originalBounds = getShapeBounds(interaction.original);
        const boundedDeltaX = Math.max(-originalBounds.left, Math.min(1 - originalBounds.right, deltaX));
        const boundedDeltaY = Math.max(-originalBounds.top, Math.min(1 - originalBounds.bottom, deltaY));
        shape.startX = interaction.original.startX + boundedDeltaX;
        shape.endX = interaction.original.endX + boundedDeltaX;
        shape.startY = interaction.original.startY + boundedDeltaY;
        shape.endY = interaction.original.endY + boundedDeltaY;
    } else {
        const bounds = getShapeBounds(interaction.original);
        if (interaction.handle.includes('w')) bounds.left = Math.max(0, Math.min(point.x, bounds.right - 0.01));
        if (interaction.handle.includes('e')) bounds.right = Math.min(1, Math.max(point.x, bounds.left + 0.01));
        if (interaction.handle.includes('n')) bounds.top = Math.max(0, Math.min(point.y, bounds.bottom - 0.01));
        if (interaction.handle.includes('s')) bounds.bottom = Math.min(1, Math.max(point.y, bounds.top + 0.01));
        shape.startX = bounds.left;
        shape.startY = bounds.top;
        shape.endX = bounds.right;
        shape.endY = bounds.bottom;
    }
    redrawHistory(canvas);
}

function finishShapeInteraction(event, canvas) {
    updateShapeInteraction(event, canvas);
    const shape = drawingHistory[shapeInteraction.index];
    socket.emit('update-shape', { index: shapeInteraction.index, ...shape });
    shapeInteraction = null;
    activeCanvas = null;
    try {
        canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released.
    }
}

function startShape(event, canvas) {
    if (permission !== 'edit') {
        return;
    }
    const point = getPoint(event, canvas);
    selectedShapeIndex = null;
    selectedShapePageId = null;
    drawing = false;
    shapeDrawing = true;
    activeCanvas = canvas;
    canvas.setPointerCapture(event.pointerId);
    activeShape = {
        type: 'shape',
        shape: shapeMode,
        pageId: Number(canvas.closest('.board-page').dataset.pageId),
        startX: point.x,
        startY: point.y,
        endX: point.x,
        endY: point.y,
        color,
        lineWidth
    };
}

function updateShape(event, canvas) {
    const point = getPoint(event, canvas);
    activeShape.endX = point.x;
    activeShape.endY = point.y;
    redrawHistory(canvas);
    drawShape(activeShape);
}

function finishShape(event, canvas) {
    updateShape(event, canvas);
    if (Math.abs(activeShape.endX - activeShape.startX) > 0.005 || Math.abs(activeShape.endY - activeShape.startY) > 0.005) {
        drawingHistory.push(activeShape);
        lastEditedPageId = activeShape.pageId;
        socket.emit('add-shape', activeShape);
        updateHistoryControls();
    }
    shapeDrawing = false;
    activeShape = null;
    activeCanvas = null;
    try {
        canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released.
    }
}

function cancelShapeOrDrawing() {
    if (shapeInteraction && activeCanvas) {
        const shape = drawingHistory[shapeInteraction.index];
        Object.assign(shape, shapeInteraction.original);
        shapeInteraction = null;
        redrawHistory(activeCanvas);
    }
    if (shapeDrawing && activeCanvas) {
        shapeDrawing = false;
        activeShape = null;
        redrawHistory(activeCanvas);
    }
    stopDrawing();
}

function drawText(textObj) {
    // Render text on canvas using normalized coordinates
    const canvas = getPageCanvas(textObj.pageId || 1);
    if (!canvas) {
        return;
    }
    const context = canvas.getContext('2d');
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    
    const fontSize = textObj.fontSize || 16;
    context.font = `${fontSize}px Arial, sans-serif`;
    context.fillStyle = textObj.color || 'black';
    context.textBaseline = 'top';
    context.fillText(textObj.text, textObj.x * canvasWidth, textObj.y * canvasHeight);
}

function drawTextWithSelection(textObj, index, pageId, isSelected) {
    // Render text on canvas with selection highlight
    const canvas = getPageCanvas(textObj.pageId || 1);
    if (!canvas) {
        return;
    }
    const context = canvas.getContext('2d');
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    
    const fontSize = textObj.fontSize || 16;
    context.font = `${fontSize}px Arial, sans-serif`;
    context.fillStyle = textObj.color || 'black';
    context.textBaseline = 'top';
    
    const x = textObj.x * canvasWidth;
    const y = textObj.y * canvasHeight;
    
    // Draw selection box if selected
    if (isSelected) {
        const textMetrics = context.measureText(textObj.text);
        const width = textMetrics.width;
        const ascent = textMetrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = textMetrics.actualBoundingBoxDescent || fontSize * 0.2;
        const height = ascent + descent + 4;
        
        context.strokeStyle = '#00aaff';
        context.lineWidth = 2;
        context.strokeRect(x - 2, y - 2, width + 4, height + 4);
        
        // Draw selection handles
        context.fillStyle = '#00aaff';
        context.fillRect(x - 4, y - 4, 8, 8);
        context.fillRect(x + width - 4, y - 4, 8, 8);
        context.fillRect(x - 4, y + height - 4, 8, 8);
        context.fillRect(x + width - 4, y + height - 4, 8, 8);
    }
    
    context.fillStyle = textObj.color || 'black';
    context.fillText(textObj.text, x, y);
}

function getTextAtPoint(point, pageId) {
    // Find if there's a text object at the clicked point
    const pageTexts = drawingHistory.filter(
        (item) => item.type === 'text' && (item.pageId || 1) === pageId
    );
    
    console.log(`[getTextAtPoint] page ${pageId}: found ${pageTexts.length} text objects`);
    
    // Get canvas for measuring text
    const canvas = getPageCanvas(pageId);
    if (!canvas) {
        console.log('[getTextAtPoint] canvas not found');
        return null;
    }
    
    const context = canvas.getContext('2d');
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    
    // Check from last to first (most recent text on top)
    for (let i = pageTexts.length - 1; i >= 0; i--) {
        const textObj = pageTexts[i];
        const fontSize = textObj.fontSize || 16;
        context.font = `${fontSize}px Arial, sans-serif`;
        
        const x = textObj.x * canvasWidth;
        const y = textObj.y * canvasHeight;
        const textMetrics = context.measureText(textObj.text);
        const width = textMetrics.width;
        // Use actual bounding box metrics for more accurate height
        const ascent = textMetrics.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = textMetrics.actualBoundingBoxDescent || fontSize * 0.2;
        const height = ascent + descent + 4;
        
        const clickX = point.x * canvasWidth;
        const clickY = point.y * canvasHeight;
        
        console.log(`[getTextAtPoint] checking text "${textObj.text}" at x=${x}, y=${y}, w=${width}, h=${height}`);
        console.log(`[getTextAtPoint] click at x=${clickX}, y=${clickY}`);
        console.log(`[getTextAtPoint] bounds: x: [${x - 5}, ${x + width + 5}], y: [${y - 5}, ${y + height + 5}]`);
        
        // Check if click is within text bounds (with padding)
        if (clickX >= x - 5 && clickX <= x + width + 5 &&
            clickY >= y - 5 && clickY <= y + height + 5) {
            // Return the actual index in drawingHistory
            const historyIndex = drawingHistory.indexOf(textObj);
            console.log(`[getTextAtPoint] FOUND text at history index ${historyIndex}`);
            return historyIndex;
        }
    }
    
    console.log('[getTextAtPoint] no text found at click point');
    return null;
}

function clearBoard() {
    // These commands are handled by the server so every connected editor stays synced.
    socket.emit('clear-page', { pageId: lastEditedPageId });
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
    
    // Clear text selection when starting to draw
    selectedTextIndex = null;
    selectedTextPageId = null;
    
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

    lastEditedPageId = line.pageId;
    drawingHistory.push(line);
    drawLine(line);
    socket.emit('draw', line);
    canvas.lastPoint = point;
}

function stopDrawing() {
    drawing = false;
    draggingText = false;
    selectedTextIndex = null;
    selectedTextPageId = null;
    if (activeCanvas) {
        activeCanvas.lastPoint = null;
    }
    activeCanvas = null;
}

function openTextEditor({
    canvas,
    pageId,
    point,
    initialValue = '',
    existingTextIndex = null,
    clickPosition = null
}) {
    const startPoint = point || { x: 0, y: 0 };
    const initialClientX = clickPosition ? clickPosition.clientX : window.innerWidth / 2;
    const initialClientY = clickPosition ? clickPosition.clientY : window.innerHeight / 2;
    let draftPoint = { ...startPoint };
    let isDraggingInput = false;
    let dragOffset = { x: 0, y: 0 };

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue;
    input.placeholder = 'Type text...';
    input.style.position = 'fixed';
    input.style.left = `${initialClientX}px`;
    input.style.top = `${initialClientY}px`;
    input.style.padding = '4px 8px';
    input.style.fontSize = `${textFontSize}px`;
    input.style.border = `2px solid ${color}`;
    input.style.borderRadius = '4px';
    input.style.zIndex = '1000';
    input.style.fontFamily = 'Arial, sans-serif';
    input.style.cursor = 'move';
    input.style.background = '#fff';

    const updateDraftPointFromInput = () => {
        const canvasRect = canvas.getBoundingClientRect();
        const centerX = input.offsetLeft + (input.offsetWidth / 2);
        const centerY = input.offsetTop + (input.offsetHeight / 2);
        const normalizedX = (centerX - canvasRect.left) / canvasRect.width;
        const normalizedY = (centerY - canvasRect.top) / canvasRect.height;
        draftPoint = {
            x: Math.max(0, Math.min(1, normalizedX)),
            y: Math.max(0, Math.min(1, normalizedY))
        };
    };

    const removeInput = () => {
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
    };

    const finishTextEditing = () => {
        const text = input.value.trim();
        if (!text) {
            if (existingTextIndex !== null && drawingHistory[existingTextIndex]) {
                const removedItem = drawingHistory[existingTextIndex];
                drawingHistory.splice(existingTextIndex, 1);
                selectedTextIndex = null;
                selectedTextPageId = null;
                draggingText = false;
                redrawHistory(canvas);
                socket.emit('delete-text', {
                    index: existingTextIndex,
                    pageId: removedItem.pageId || pageId
                });
            }
            removeInput();
            textMode = false;
            textToolButton.classList.remove('is-active');
            document.body.style.cursor = 'auto';
            return;
        }

        const textObj = {
            type: 'text',
            pageId,
            x: draftPoint.x,
            y: draftPoint.y,
            text,
            color,
            fontSize: textFontSize
        };

        if (existingTextIndex !== null && drawingHistory[existingTextIndex]) {
            const existingText = drawingHistory[existingTextIndex];
            Object.assign(existingText, textObj);
            redrawHistory(canvas);
            socket.emit('update-text', { index: existingTextIndex, ...textObj });
        } else {
            lastEditedPageId = pageId;
            drawingHistory.push(textObj);
            redrawHistory(canvas);
            socket.emit('add-text', textObj);
        }

        removeInput();
        textMode = false;
        textToolButton.classList.remove('is-active');
        document.body.style.cursor = 'auto';
    };

    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        isDraggingInput = true;
        dragOffset.x = event.clientX - input.getBoundingClientRect().left;
        dragOffset.y = event.clientY - input.getBoundingClientRect().top;
        input.setPointerCapture(event.pointerId);
    });

    input.addEventListener('pointermove', (event) => {
        if (!isDraggingInput) {
            return;
        }

        const maxLeft = window.innerWidth - input.offsetWidth - 12;
        const maxTop = window.innerHeight - input.offsetHeight - 12;
        const nextLeft = Math.max(8, Math.min(event.clientX - dragOffset.x, maxLeft));
        const nextTop = Math.max(8, Math.min(event.clientY - dragOffset.y, maxTop));
        input.style.left = `${nextLeft}px`;
        input.style.top = `${nextTop}px`;
        updateDraftPointFromInput();
    });

    input.addEventListener('pointerup', () => {
        isDraggingInput = false;
    });

    input.addEventListener('pointercancel', () => {
        isDraggingInput = false;
    });

    input.addEventListener('blur', finishTextEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishTextEditing();
        } else if (e.key === 'Escape') {
            removeInput();
            textMode = false;
            textToolButton.classList.remove('is-active');
            document.body.style.cursor = 'auto';
        }
    });
}

function handleTextInputClick(event, canvas) {
    const point = getPoint(event, canvas);
    const pageId = Number(canvas.closest('.board-page').dataset.pageId);
    openTextEditor({
        canvas,
        pageId,
        point,
        clickPosition: { clientX: event.clientX, clientY: event.clientY }
    });
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
    selectedShapeIndex = null;
    selectedShapePageId = null;
    shapeInteraction = null;
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

socket.on('add-text', (textObj) => {
    drawingHistory.push(textObj);
    drawText(textObj);
    updateHistoryControls();
});

socket.on('add-shape', (shape) => {
    drawingHistory.push(shape);
    drawShape(shape);
    updateHistoryControls();
});

socket.on('update-shape', (data) => {
    const shape = drawingHistory[data.index];
    if (!shape || shape.type !== 'shape') {
        return;
    }
    shape.startX = data.startX;
    shape.startY = data.startY;
    shape.endX = data.endX;
    shape.endY = data.endY;
    const canvas = getPageCanvas(shape.pageId || 1);
    if (canvas) {
        redrawHistory(canvas);
    }
});

socket.on('move-text', (data) => {
    // Update text position when other users move text
    if (drawingHistory[data.index]) {
        drawingHistory[data.index].x = data.x;
        drawingHistory[data.index].y = data.y;
        const canvas = getPageCanvas(data.pageId);
        if (canvas) {
            redrawHistory(canvas);
        }
    }
});

socket.on('delete-text', (data) => {
    if (!Number.isInteger(data.index)) {
        return;
    }
    if (drawingHistory[data.index] && drawingHistory[data.index].type === 'text') {
        drawingHistory.splice(data.index, 1);
        selectedTextIndex = null;
        selectedTextPageId = null;
        draggingText = false;
        const canvas = getPageCanvas(data.pageId || 1);
        if (canvas) {
            redrawHistory(canvas);
        }
        updateHistoryControls();
    }
});

socket.on('update-text', (data) => {
    if (!drawingHistory[data.index] || drawingHistory[data.index].type !== 'text') {
        return;
    }

    drawingHistory[data.index].text = data.text;
    drawingHistory[data.index].x = typeof data.x === 'number' ? data.x : drawingHistory[data.index].x;
    drawingHistory[data.index].y = typeof data.y === 'number' ? data.y : drawingHistory[data.index].y;
    drawingHistory[data.index].pageId = typeof data.pageId === 'number' ? data.pageId : drawingHistory[data.index].pageId;
    drawingHistory[data.index].color = typeof data.color === 'string' ? data.color : drawingHistory[data.index].color;
    drawingHistory[data.index].fontSize = typeof data.fontSize === 'number' ? data.fontSize : drawingHistory[data.index].fontSize;

    const canvas = getPageCanvas(data.pageId || drawingHistory[data.index].pageId || 1);
    if (canvas) {
        redrawHistory(canvas);
    }
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
