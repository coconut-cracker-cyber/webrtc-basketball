const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const gameControls = document.getElementById('game-controls');
const jumpBtn = document.getElementById('jump-btn');
const arrow = document.getElementById('arrow');
const scoreValue = document.getElementById('score-value');

// Game Constants
const GRAVITY = 0.4;
const FRICTION = 0.98;
const JUMP_FORCE_MULTIPLIER = 0.3;
const MAX_JUMP_FORCE = 25;
const TILT_SENSITIVITY = 1.5;

// Game State
let gameState = 'start'; // start, playing, gameover
let score = 0;
let cameraY = 0;
let lastTime = 0;

// Input State
let tiltX = 0; // Gamma: Left/Right
let tiltY = 0; // Beta: Front/Back
let tiltVector = { x: 0, y: 0, magnitude: 0, angle: 0 };

// Player
const player = {
    x: 0,
    y: 0,
    radius: 15,
    vx: 0,
    vy: 0,
    state: 'stuck', // stuck, air
    color: '#00ff88'
};

// World
let walls = [];
const WALL_WIDTH_MIN = 50;
const WALL_WIDTH_MAX = 150;
const WALL_HEIGHT = 20;
const GAP_Y_MIN = 100;
const GAP_Y_MAX = 250;
let highestGenY = 0;

// Resize handling
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Reset player position if starting
    if (gameState === 'start') {
        player.x = canvas.width / 2;
        player.y = canvas.height - 100;
        cameraY = 0;
        generateInitialWalls();
    }
}
window.addEventListener('resize', resize);

// Initialization
function init() {
    resize();
    requestAnimationFrame(gameLoop);
}

function generateInitialWalls() {
    walls = [];
    // Floor
    walls.push({
        x: 0,
        y: canvas.height - 50,
        w: canvas.width,
        h: 50,
        type: 'floor'
    });

    highestGenY = canvas.height - 50;

    // Generate some starter walls
    for (let i = 0; i < 10; i++) {
        generateNextWall();
    }
}

function generateNextWall() {
    const gap = GAP_Y_MIN + Math.random() * (GAP_Y_MAX - GAP_Y_MIN);
    const y = highestGenY - gap;
    const w = WALL_WIDTH_MIN + Math.random() * (WALL_WIDTH_MAX - WALL_WIDTH_MIN);
    const x = Math.random() * (canvas.width - w);

    walls.push({ x, y, w, h: WALL_HEIGHT, type: 'wall' });
    highestGenY = y;
}

// Input Handling
function handleOrientation(event) {
    // gamma: left to right tilt in degrees, where right is positive
    // beta: front to back tilt in degrees, where front is positive

    // Clamp values
    let gamma = event.gamma || 0; // -90 to 90
    let beta = event.beta || 0;   // -180 to 180

    // Calculate tilt vector
    // We want "flat" to be (0,0).
    // User said: "phone should be hold flat like on a table"

    tiltX = gamma * TILT_SENSITIVITY;
    tiltY = beta * TILT_SENSITIVITY;

    // Calculate magnitude and angle for the arrow
    const dx = tiltX;
    const dy = tiltY;

    tiltVector.magnitude = Math.min(Math.sqrt(dx * dx + dy * dy), 100); // Cap magnitude
    tiltVector.angle = Math.atan2(dy, dx);

    // Update Arrow UI
    updateArrowUI();
}

function updateArrowUI() {
    // Arrow points in direction of tilt
    // Length depends on magnitude
    const rotationDeg = (tiltVector.angle * 180 / Math.PI) + 90; // +90 because arrow points up by default CSS
    const scale = tiltVector.magnitude / 50; // Scale factor

    arrow.style.transform = `rotate(${rotationDeg}deg) scaleY(${0.5 + scale * 0.5})`;

    // Color shift based on power
    const intensity = Math.min(tiltVector.magnitude / 80, 1);
    arrow.style.borderBottomColor = `rgb(${255 * intensity}, ${255 * (1 - intensity)}, 100)`;
}

function jump() {
    if (player.state !== 'stuck') return;

    // Jump in OPPOSITE direction of tilt
    // Force depends on tilt magnitude
    const force = Math.min(tiltVector.magnitude * JUMP_FORCE_MULTIPLIER, MAX_JUMP_FORCE);

    // Angle is opposite to tilt
    const jumpAngle = tiltVector.angle + Math.PI;

    player.vx = Math.cos(jumpAngle) * force;
    player.vy = Math.sin(jumpAngle) * force;

    player.state = 'air';

    // Vibrate
    if (navigator.vibrate) {
        navigator.vibrate(Math.floor(force * 5)); // 0-125ms vibration
    }
}

// Physics & Logic
function update(dt) {
    if (gameState !== 'playing') return;

    // Apply Gravity
    if (player.state === 'air') {
        player.vy += GRAVITY;
        player.vx *= FRICTION; // Air resistance

        player.x += player.vx;
        player.y += player.vy;

        // Wall Collisions
        checkCollisions();

        // Screen Boundaries (Bounce off sides)
        if (player.x - player.radius < 0) {
            player.x = player.radius;
            player.vx *= -0.8;
        } else if (player.x + player.radius > canvas.width) {
            player.x = canvas.width - player.radius;
            player.vx *= -0.8;
        }

        // Game Over Check (Fall below camera)
        if (player.y - player.radius > cameraY + canvas.height) {
            gameOver();
        }
    }

    // Camera Follow
    // Target Y is player Y centered, but we only move UP (decrease Y)
    const targetY = player.y - canvas.height * 0.6;
    if (targetY < cameraY) {
        cameraY += (targetY - cameraY) * 0.1; // Smooth follow
    }

    // Score update (inverted Y)
    const currentHeight = Math.floor(-player.y / 10);
    if (currentHeight > score) {
        score = currentHeight;
        scoreValue.textContent = score + 'm';
    }

    // Cleanup and Generate Walls
    if (cameraY < highestGenY + 800) { // Generate ahead
        generateNextWall();
    }

    // Remove walls far below
    walls = walls.filter(w => w.y < cameraY + canvas.height + 100);
}

function checkCollisions() {
    // Simple AABB vs Circle check
    // Only stick if moving towards the wall? Or just touching?
    // "sticks to the wall when he collides with it"

    for (let w of walls) {
        // Find closest point on rect to circle center
        let closestX = Math.max(w.x, Math.min(player.x, w.x + w.w));
        let closestY = Math.max(w.y, Math.min(player.y, w.y + w.h));

        let dx = player.x - closestX;
        let dy = player.y - closestY;

        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < player.radius) {
            // Collision detected
            player.state = 'stuck';
            player.vx = 0;
            player.vy = 0;

            // Snap to surface to avoid getting embedded
            // Determine which side was hit
            const overlap = player.radius - distance;
            if (overlap > 0) {
                // Normalize normal
                if (distance === 0) { // Center is inside rect
                    // Push out closest edge
                    // Simplified: just stop for now, maybe snap later if needed
                } else {
                    const nx = dx / distance;
                    const ny = dy / distance;
                    player.x += nx * overlap;
                    player.y += ny * overlap;
                }
            }
            return; // Stick to first wall hit
        }
    }
}

function gameOver() {
    gameState = 'gameover';
    alert(`Game Over! Max Height: ${score}m`);
    resetGame();
}

function resetGame() {
    gameState = 'start';
    startScreen.classList.remove('hidden');
    gameControls.classList.add('hidden');
    score = 0;
    scoreValue.textContent = '0m';
    resize();
}

// Rendering
function draw() {
    // Clear background
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

    // Draw "eyes" or details to show rotation?
    // Maybe just a simple highlight
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(player.x - 5, player.y - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// Game Loop
function gameLoop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
}

// Event Listeners
startBtn.addEventListener('click', () => {
    // Request permission for iOS 13+
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    startGame();
                } else {
                    alert('Permission denied. Game requires tilt controls.');
                }
            })
            .catch(console.error);
    } else {
        // Non-iOS or older devices
        startGame();
    }
});

function startGame() {
    gameState = 'playing';
    startScreen.classList.add('hidden');
    gameControls.classList.remove('hidden');
    window.addEventListener('deviceorientation', handleOrientation);
}

jumpBtn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent focus issues
    jump();
});
jumpBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    jump();
});

// Initial call
init();
