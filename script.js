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
const controllerArrow = document.getElementById('controller-arrow');
const puck = document.getElementById('puck');
const jumpBtn = document.getElementById('jump-btn');
const startOverlay = document.getElementById('start-overlay');
const enableSensorsBtn = document.getElementById('enable-sensors-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const controllerScore = document.getElementById('controller-score');

// Constants & Config
const ZOOM = 0.6;
const GRAVITY = 0.5;
const FRICTION = 0.99;
const JUMP_FORCE_MULTIPLIER = 0.45;
const MAX_JUMP_FORCE = 35;
const TILT_SENSITIVITY = 1.5;
const SUBSTEPS = 16; // Increased from 8 to 16 for better collision

// Variables
let peer;
let conn;
let isHost = false;
let gameState = 'start';
let score = 0;
let cameraY = 0;
let lastTime = 0;
let worldWidth = 0;
let worldHeight = 0;

// Player & World
const player = {
    x: 0,
    y: 0,
    radius: 12,
    vx: 0,
    vy: 0,
    state: 'stuck',
    color: '#00ff88'
};

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

    peer = new Peer();

    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        const url = `${window.location.href.split('?')[0]}?host=${id}`;
        new QRCode(qrcodeDiv, { text: url, width: 180, height: 180 });
        connectionStatus.textContent = "Scan with phone to start";
    });

    peer.on('connection', (c) => {
        conn = c;
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
    worldWidth = canvas.width / ZOOM;
    worldHeight = canvas.height / ZOOM;

    if (gameState === 'start') {
        player.x = worldWidth / 2;
        player.y = worldHeight - 150;
        cameraY = 0;
        generateInitialWalls();
    }
}

function generateInitialWalls() {
    walls = [];
    walls.push({ x: 0, y: worldHeight - 50, w: worldWidth, h: 100, type: 'floor' });
    highestGenY = worldHeight - 50;
    for (let i = 0; i < 15; i++) generateNextWall();
}

function generateNextWall() {
    const gapY = 150 + Math.random() * 200;
    const y = highestGenY - gapY;

    const typeRoll = Math.random();
    let type = 'normal';
    if (typeRoll > 0.7) type = 'bouncy';
    if (typeRoll > 0.9) type = 'vertical';

    let w, h, x;

    if (type === 'vertical') {
        w = 30;
        h = 200 + Math.random() * 200;
        x = Math.random() * (worldWidth - w);
    } else {
        w = 100 + Math.random() * 200;
        h = 30;
        x = Math.random() * (worldWidth - w);
    }

    walls.push({ x, y, w, h, type });
    highestGenY = y;
}

function jump() {
    if (player.state !== 'stuck') return;

    const force = Math.min(tiltVector.magnitude * JUMP_FORCE_MULTIPLIER, MAX_JUMP_FORCE);
    const jumpAngle = tiltVector.angle + Math.PI;

    player.vx = Math.cos(jumpAngle) * force;
    player.vy = Math.sin(jumpAngle) * force;
    player.state = 'air';

    if (conn) conn.send({ type: 'vibrate', duration: Math.floor(force * 5) });
}

// --- PHYSICS ENGINE (Raycast / Swept AABB) ---
function update(dt) {
    if (gameState !== 'playing') return;

    if (player.state === 'air') {
        // Apply Gravity
        player.vy += GRAVITY;
        player.vx *= FRICTION;

        // Sub-stepping for precision
        const stepDt = 1 / SUBSTEPS;

        for (let i = 0; i < SUBSTEPS; i++) {
            // Calculate proposed new position for this substep
            const nextX = player.x + player.vx * stepDt;
            const nextY = player.y + player.vy * stepDt;

            // Check for collision along the path (Raycast/Swept check)
            const collision = checkSweptCollision(player.x, player.y, nextX, nextY, player.radius);

            if (collision) {
                // Move to collision point
                player.x = collision.x;
                player.y = collision.y;

                if (collision.wall.type === 'bouncy') {
                    // Reflect
                    const nx = collision.nx;
                    const ny = collision.ny;
                    const dot = player.vx * nx + player.vy * ny;

                    player.vx = (player.vx - 2 * dot * nx) * 1.1; // Bounce with energy gain
                    player.vy = (player.vy - 2 * dot * ny) * 1.1;

                    // Push out slightly to prevent getting stuck in next frame
                    player.x += nx * 0.1;
                    player.y += ny * 0.1;

                    // Don't stop stepping, keep moving with new velocity? 
                    // For simplicity, just consume this substep and continue next with new velocity
                } else {
                    // Stick
                    player.state = 'stuck';
                    player.vx = 0;
                    player.vy = 0;
                    break; // Stop all movement
                }
            } else {
                // No collision, move normally
                player.x = nextX;
                player.y = nextY;
            }

            // World Boundaries
            if (player.x - player.radius < 0) {
                player.x = player.radius;
                player.vx *= -0.8;
            } else if (player.x + player.radius > worldWidth) {
                player.x = worldWidth - player.radius;
                player.vx *= -0.8;
            }
        }

        if (player.y - player.radius > cameraY + worldHeight + 200) gameOver();
    }

    // Camera
    const targetY = player.y - worldHeight * 0.6;
    if (targetY < cameraY) cameraY += (targetY - cameraY) * 0.1;

    // Score
    const currentHeight = Math.floor(-player.y / 10);
    if (currentHeight > score) {
        score = currentHeight;
        scoreValue.textContent = score + 'm';
        // Send score to controller occasionally
        if (conn && conn.open && score % 10 === 0) {
            conn.send({ type: 'score', value: score + 'm' });
        }
    }

    if (cameraY < highestGenY + 1000) generateNextWall();
    walls = walls.filter(w => w.y < cameraY + worldHeight + 200);
}

// Robust Collision Detection
function checkSweptCollision(startX, startY, endX, endY, radius) {
    // 1. Broad Phase: AABB of the move
    const minX = Math.min(startX, endX) - radius;
    const maxX = Math.max(startX, endX) + radius;
    const minY = Math.min(startY, endY) - radius;
    const maxY = Math.max(startY, endY) + radius;

    let closestHit = null;
    let minT = 1.0; // Time of impact (0 to 1)

    for (let w of walls) {
        // Broad phase check
        if (w.x > maxX || w.x + w.w < minX || w.y > maxY || w.y + w.h < minY) continue;

        // 2. Narrow Phase: AABB vs Moving Circle
        // Simplified: Clamp point on rect to circle center line
        // We check if the line segment (startX, startY) -> (endX, endY) intersects the "expanded" rectangle (minkowski sum)
        // Actually, simpler: Find the closest point on the wall to the *segment*.

        // Let's use a continuous logic:
        // Find time 't' where distance(Circle(t), Rect) <= 0

        // Simplified Raycast approach:
        // Check intersection of segment with expanded rect bounds
        // Expand rect by radius
        const expandedX = w.x - radius;
        const expandedY = w.y - radius;
        const expandedW = w.w + radius * 2;
        const expandedH = w.h + radius * 2;

        // Ray vs AABB (Liang-Barsky or similar)
        // dx, dy
        const dx = endX - startX;
        const dy = endY - startY;

        // p = start + t * d
        // Check x-slabs
        let tNear = 0;
        let tFar = 1;
        let nx = 0, ny = 0; // Normals at impact

        // X Axis
        if (dx === 0) {
            if (startX < expandedX || startX > expandedX + expandedW) continue; // Parallel and outside
        } else {
            let t1 = (expandedX - startX) / dx;
            let t2 = (expandedX + expandedW - startX) / dx;

            if (t1 > t2) [t1, t2] = [t2, t1]; // Swap

            if (t1 > tNear) { tNear = t1; nx = -1; ny = 0; } // Hit left
            if (t2 < tFar) tFar = t2;

            if (tNear > tFar || tFar < 0) continue;
        }

        // Y Axis
        if (dy === 0) {
            if (startY < expandedY || startY > expandedY + expandedH) continue;
        } else {
            let t1 = (expandedY - startY) / dy;
            let t2 = (expandedY + expandedH - startY) / dy;

            if (t1 > t2) [t1, t2] = [t2, t1];

            // Refine normal based on which axis was last cut
            if (t1 > tNear) {
                tNear = t1;
                nx = 0;
                ny = -1; // Hit top (usually)
            }
            if (t2 < tFar) tFar = t2;

            if (tNear > tFar || tFar < 0) continue;
        }

        // If we got here, there is an intersection at tNear
        if (tNear < minT && tNear >= 0) {
            // Verify it's a valid hit (not starting inside)
            // Actually, if tNear is very small, we might be inside.

            // Refine Normal:
            // The above slab method gives a rough normal. 
            // Let's determine exact side of the *original* rect we hit.
            // Point of impact on expanded rect:
            const impactX = startX + dx * tNear;
            const impactY = startY + dy * tNear;

            // Check if this impact point corresponds to a corner (rounded) or edge
            // For this game, "Box" collision is fine, we don't need perfect rounded corners for the walls.
            // Just treat walls as sharp rectangles.

            // Determine exact normal based on relative position to center of wall
            const cx = w.x + w.w / 2;
            const cy = w.y + w.h / 2;
            const px = impactX - cx;
            const py = impactY - cy;

            // Normalize to box size
            const nx_raw = px / (w.w / 2 + radius);
            const ny_raw = py / (w.h / 2 + radius);

            let finalNx = 0, finalNy = 0;
            if (Math.abs(nx_raw) > Math.abs(ny_raw)) {
                finalNx = Math.sign(nx_raw);
            } else {
                finalNy = Math.sign(ny_raw);
            }

            minT = tNear;
            closestHit = {
                x: startX + dx * tNear,
                y: startY + dy * tNear,
                nx: finalNx,
                ny: finalNy,
                wall: w
            };
        }
    }

    return closestHit;
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
    gameState = 'playing';
}

function draw() {
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(0, -cameraY);

    // Walls
    for (let w of walls) {
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 5);

        if (w.type === 'bouncy') {
            ctx.fillStyle = 'rgba(255, 0, 255, 0.2)';
            ctx.strokeStyle = '#ff00ff';
            ctx.shadowColor = '#ff00ff';
        } else if (w.type === 'vertical') {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.1)';
            ctx.strokeStyle = '#ffff00';
            ctx.shadowColor = '#ffff00';
        } else {
            ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
            ctx.strokeStyle = '#00ccff';
            ctx.shadowColor = '#00ccff';
        }

        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
    }

    // Player
    ctx.shadowBlur = 20;
    ctx.shadowColor = player.color;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();

    // Aim Line
    if (player.state === 'stuck') {
        const jumpAngle = tiltVector.angle + Math.PI;
        const lineLen = tiltVector.magnitude * 3;

        ctx.beginPath();
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(player.x + Math.cos(jumpAngle) * lineLen, player.y + Math.sin(jumpAngle) * lineLen);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
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
            statusDot.classList.add('connected');
            statusText.textContent = "Connected";
            startOverlay.style.display = 'flex';
        });

        conn.on('data', (data) => {
            if (data.type === 'vibrate' && navigator.vibrate) {
                navigator.vibrate(data.duration);
            }
            if (data.type === 'score') {
                controllerScore.textContent = data.value;
            }
        });
    });

    enableSensorsBtn.addEventListener('click', () => {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') startController();
                    else alert('Permission denied');
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
    jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); sendJump(); });
    jumpBtn.addEventListener('mousedown', (e) => { e.preventDefault(); sendJump(); });
}

function handleOrientation(event) {
    let gamma = event.gamma || 0;
    let beta = event.beta || 0;

    const x = gamma * TILT_SENSITIVITY;
    const y = beta * TILT_SENSITIVITY;

    const magnitude = Math.min(Math.sqrt(x * x + y * y), 100);
    const angle = Math.atan2(y, x);

    tiltVector = { x, y, magnitude, angle };
    updateControllerUI();

    if (conn && conn.open) conn.send({ type: 'tilt', vector: tiltVector });
}

function updateControllerUI() {
    // Update Arrow
    const rotationDeg = (tiltVector.angle * 180 / Math.PI) + 90;
    const scale = tiltVector.magnitude / 50;
    controllerArrow.style.transform = `rotate(${rotationDeg}deg) scaleY(${0.5 + scale * 0.5})`;

    // Update Puck Position (Radar)
    // Map tilt vector (x,y) to puck position
    // Max magnitude is 100. Radar radius is 140px.
    const maxRad = 120; // Keep inside
    const px = (tiltVector.x / 100) * maxRad;
    const py = (tiltVector.y / 100) * maxRad;

    // Limit puck to circle
    const dist = Math.sqrt(px * px + py * py);
    let finalPx = px;
    let finalPy = py;
    if (dist > maxRad) {
        finalPx = (px / dist) * maxRad;
        finalPy = (py / dist) * maxRad;
    }

    puck.style.transform = `translate(${finalPx}px, ${finalPy}px)`;
}

function sendJump() {
    if (conn && conn.open) conn.send({ type: 'jump' });
}

init();
