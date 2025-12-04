// DOM Elements
const hostView = document.getElementById('host-view');
const controllerView = document.getElementById('controller-view');
const connectionScreen = document.getElementById('connection-screen');
const connectionStatus = document.getElementById('connection-status');
const qrcodeDiv = document.getElementById('qrcode');

// Game State (Host)
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreValue = document.getElementById('score-value');

// Controller State
const arrow = document.getElementById('arrow');
const jumpBtn = document.getElementById('jump-btn');
const startOverlay = document.getElementById('start-overlay');
const enableSensorsBtn = document.getElementById('enable-sensors-btn');

// Constants
const GRAVITY = 0.4;
const FRICTION = 0.98;
const JUMP_FORCE_MULTIPLIER = 0.3;
const MAX_JUMP_FORCE = 25;
const TILT_SENSITIVITY = 1.5;

// Variables
let peer;
let conn;
let isHost = false;
let gameState = 'start';
let score = 0;
let cameraY = 0;
let lastTime = 0;

// Player & World
const player = { x: 0, y: 0, radius: 15, vx: 0, vy: 0, state: 'stuck', color: '#00ff88' };
let walls = [];
let highestGenY = 0;
let tiltVector = { x: 0, y: 0, magnitude: 0, angle: 0 };

// --- INITIALIZATION ---
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const hostId = urlParams.get('host');

    if (hostId) {
        initController(hostId);
    } else {
        initHost();
    }
}

// --- HOST LOGIC ---
function initHost() {
    isHost = true;
    hostView.classList.remove('hidden');

    // Initialize PeerJS
    peer = new Peer();

    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        const url = `${window.location.href.split('?')[0]}?host=${id}`;

        // Generate QR Code
        new QRCode(qrcodeDiv, {
            text: url,
            width: 180,
            height: 180
        });

        connectionStatus.textContent = "Scan with phone to start";
    });

    peer.on('connection', (c) => {
        conn = c;
        console.log('Connected to controller');
        connectionStatus.textContent = "Controller Connected!";

        setTimeout(() => {
            connectionScreen.style.opacity = 0;
            setTimeout(() => connectionScreen.classList.add('hidden'), 500);
            startGame();
        }, 1000);

        setupHostDataListener();
    });

    resize();
    window.addEventListener('resize', resize);
    requestAnimationFrame(gameLoop);
}

function setupHostDataListener() {
    conn.on('data', (data) => {
        if (data.type === 'tilt') {
            tiltVector = data.vector;
        } else if (data.type === 'jump') {
            jump();
        }
    });
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (gameState === 'start') {
        player.x = canvas.width / 2;
        player.y = canvas.height - 100;
        cameraY = 0;
        generateInitialWalls();
    }
}

function generateInitialWalls() {
    walls = [];
    walls.push({ x: 0, y: canvas.height - 50, w: canvas.width, h: 50, type: 'floor' });
    highestGenY = canvas.height - 50;
    for (let i = 0; i < 10; i++) generateNextWall();
}

function generateNextWall() {
    const gap = 100 + Math.random() * 150;
    const y = highestGenY - gap;
    const w = 50 + Math.random() * 100;
    const x = Math.random() * (canvas.width - w);
    walls.push({ x, y, w, h: 20, type: 'wall' });
    highestGenY = y;
}

function jump() {
    if (player.state !== 'stuck') return;

    // Jump opposite to tilt
    const force = Math.min(tiltVector.magnitude * JUMP_FORCE_MULTIPLIER, MAX_JUMP_FORCE);
    const jumpAngle = tiltVector.angle + Math.PI; // Opposite direction

    player.vx = Math.cos(jumpAngle) * force;
    player.vy = Math.sin(jumpAngle) * force;
    player.state = 'air';

    // Send haptic feedback command back to controller
    if (conn) {
        conn.send({ type: 'vibrate', duration: Math.floor(force * 5) });
    }
}

function update(dt) {
    if (gameState !== 'playing') return;

    if (player.state === 'air') {
        player.vy += GRAVITY;
        player.vx *= FRICTION;
        player.x += player.vx;
        player.y += player.vy;

        checkCollisions();

        if (player.x < 0 || player.x > canvas.width) player.vx *= -0.8;
        if (player.y > cameraY + canvas.height + 100) gameOver();
    }

    const targetY = player.y - canvas.height * 0.6;
    if (targetY < cameraY) cameraY += (targetY - cameraY) * 0.1;

    const currentHeight = Math.floor(-player.y / 10);
    if (currentHeight > score) {
        score = currentHeight;
        scoreValue.textContent = score + 'm';
    }

    if (cameraY < highestGenY + 800) generateNextWall();
    walls = walls.filter(w => w.y < cameraY + canvas.height + 100);
}

function checkCollisions() {
    for (let w of walls) {
        let closestX = Math.max(w.x, Math.min(player.x, w.x + w.w));
        let closestY = Math.max(w.y, Math.min(player.y, w.y + w.h));
        let dist = Math.hypot(player.x - closestX, player.y - closestY);

        if (dist < player.radius) {
            player.state = 'stuck';
            player.vx = 0;
            player.vy = 0;
            return;
        }
    }
}

function gameOver() {
    gameState = 'gameover';
    alert(`Game Over! Height: ${score}m`);
    resetGame();
}

function resetGame() {
    gameState = 'start';
    score = 0;
    scoreValue.textContent = '0m';
    resize();
    // Don't show QR code again, just wait for jump to restart? 
    // Or just let them play again immediately.
    gameState = 'playing';
}

function draw() {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(0, -cameraY);

    // Draw Walls
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0, 204, 255, 0.5)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;
    for (let w of walls) {
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 5);
        ctx.fill();
        ctx.stroke();
    }

    // Draw Player
    ctx.shadowBlur = 20;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();

    // Draw Aim Line (if stuck)
    if (player.state === 'stuck') {
        ctx.beginPath();
        ctx.moveTo(player.x, player.y);
        // Draw line in direction of tilt (opposite of jump)
        // Actually user wants to see where they aim.
        // If tilt is "down", jump is "up".
        // Let's show the trajectory (Jump direction)
        const jumpAngle = tiltVector.angle + Math.PI;
        const lineLen = tiltVector.magnitude * 2;
        ctx.lineTo(player.x + Math.cos(jumpAngle) * lineLen, player.y + Math.sin(jumpAngle) * lineLen);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.restore();
}

function gameLoop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(gameLoop);
}

function startGame() {
    gameState = 'playing';
}


// --- CONTROLLER LOGIC ---
function initController(hostId) {
    controllerView.classList.remove('hidden');

    peer = new Peer();

    peer.on('open', (id) => {
        conn = peer.connect(hostId);

        conn.on('open', () => {
            console.log('Connected to host');
            startOverlay.style.display = 'flex'; // Show start button
        });

        conn.on('data', (data) => {
            if (data.type === 'vibrate' && navigator.vibrate) {
                navigator.vibrate(data.duration);
            }
        });
    });

    enableSensorsBtn.addEventListener('click', () => {
        // Request Permissions
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        startController();
                    } else {
                        alert('Permission denied');
                    }
                })
                .catch(console.error);
        } else {
            startController();
        }
    });
}

function startController() {
    startOverlay.style.display = 'none';
    window.addEventListener('deviceorientation', handleOrientation);

    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        sendJump();
    });
    jumpBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sendJump();
    });
}

function handleOrientation(event) {
    let gamma = event.gamma || 0; // Left/Right
    let beta = event.beta || 0;   // Front/Back

    // Calculate vector
    // Assuming flat phone:
    // Beta: -180 to 180. Flat is 0. Tilted forward (top down) is positive? No, usually top up is negative?
    // Actually:
    // Beta: Front-to-back. 0 is flat. Positive is top-down? 
    // Gamma: Left-to-right. 0 is flat.

    const x = gamma * TILT_SENSITIVITY;
    const y = beta * TILT_SENSITIVITY;

    const magnitude = Math.min(Math.sqrt(x * x + y * y), 100);
    const angle = Math.atan2(y, x);

    tiltVector = { x, y, magnitude, angle };

    // Update UI
    updateArrowUI();

    // Send to Host
    if (conn && conn.open) {
        conn.send({ type: 'tilt', vector: tiltVector });
    }
}

function updateArrowUI() {
    const rotationDeg = (tiltVector.angle * 180 / Math.PI) + 90;
    const scale = tiltVector.magnitude / 50;
    arrow.style.transform = `rotate(${rotationDeg}deg) scaleY(${0.5 + scale * 0.5})`;
}

function sendJump() {
    if (conn && conn.open) {
        conn.send({ type: 'jump' });
    }
}

// Start
init();
