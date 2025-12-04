// --- KONFIGURATION ---
// Wir nutzen PeerJS Cloud Server (kostenlos, aber limitiert). Für Produktion eigenen Server nutzen.
const peerConfig = {
    debug: 2
};

// URL Parameter prüfen um Modus zu bestimmen
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode'); // 'controller' oder null (desktop)
const hostId = urlParams.get('id'); // ID des Desktops, mit dem wir uns verbinden

// --- LOGIK WEICHE ---
if (mode === 'controller' && hostId) {
    initController(hostId);
} else {
    initGame();
}

// ==========================================
// TEIL 1: DESKTOP / GAME LOGIC
// ==========================================
function initGame() {
    document.getElementById('game-screen').style.display = 'block';

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    let width, height;

    // PeerJS Setup
    const peer = new Peer(null, peerConfig);
    let conn = null;

    peer.on('open', (id) => {
        console.log('Meine Peer ID ist: ' + id);

        // QR Code generieren
        const joinUrl = `${window.location.href.split('?')[0]}?mode=controller&id=${id}`;
        new QRCode(document.getElementById("qrcode"), {
            text: joinUrl,
            width: 128,
            height: 128
        });
    });

    peer.on('connection', (c) => {
        conn = c;
        document.getElementById('desktop-status').innerText = "Controller verbunden!";
        document.getElementById('desktop-status').style.color = "#0f0";

        // Daten vom Handy empfangen
        conn.on('data', (data) => {
            if (data.type === 'throw') {
                spawnBall(data.forceZ, data.forceY, data.direction);
            }
        });
    });

    // Spiel-Objekte
    const balls = [];
    const hoop = { x: 0, y: 0, width: 120, height: 10, z: 500 }; // Z ist die Tiefe

    // Resize Handler
    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        // Korb positionieren (Mitte, etwas oben, "hinten" im Raum)
        hoop.x = width / 2;
        hoop.y = height * 0.3;
    }
    window.addEventListener('resize', resize);
    resize();

    function spawnBall(forceZ, forceY, direction) {
        // forceZ: Wurfkraft nach vorne (Beschleunigung Z)
        // forceY: Wurfkraft nach oben (Beschleunigung Y)
        // direction: Seitliche Neigung (Gamma)

        // Normalisierung der Werte für das Spiel
        // forceZ ist typischerweise zwischen 10 und 50 m/s^2 bei einem Wurf
        const velocityZ = Math.min(Math.max(forceZ, 5), 60) * 1.5; 
        
        // forceY ist typischerweise positiv beim Wurf nach oben
        const velocityY = -Math.min(Math.max(forceY, 5), 30) * 1.2; 
        
        const velocityX = direction * 0.5; // Seitliche Drift

        balls.push({
            x: width / 2,       // Startet unten mittig
            y: height,
            z: 0,               // Startet "vorne" am Bildschirm
            prevX: width / 2,
            prevY: height,
            prevZ: 0,
            vx: velocityX,
            vy: velocityY,
            vz: velocityZ,
            radius: 40,         // Startradius
            color: 'orange',
            scored: false
        });
    }

    function update() {
        ctx.clearRect(0, 0, width, height);

        // 1. Korb zeichnen (2.5D - wird kleiner je weiter weg, hier statisch weit weg)
        // Einfache Darstellung des Korbs (Backboard + Ring)
        const depthScale = 1000 / (1000 + hoop.z); // Perspektivische Skalierung
        const hW = hoop.width * depthScale;
        const hX = hoop.x - hW / 2;
        const hY = hoop.y;

        // Backboard
        ctx.fillStyle = "white";
        ctx.fillRect(hX - 20 * depthScale, hY - 80 * depthScale, hW + 40 * depthScale, 80 * depthScale);
        ctx.strokeStyle = "red";
        ctx.strokeRect(hX + hW * 0.3, hY - 60 * depthScale, hW * 0.4, 40 * depthScale);

        // Ring (Ellipse)
        ctx.beginPath();
        ctx.ellipse(hoop.x, hY, hW / 2, 10 * depthScale, 0, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "orange";
        ctx.stroke();


        // 2. Bälle updaten und zeichnen
        for (let i = balls.length - 1; i >= 0; i--) {
            let b = balls[i];

            // Speichere vorherige Position für Kollisionserkennung
            b.prevX = b.x;
            b.prevY = b.y;
            b.prevZ = b.z;

            // Physik
            b.x += b.vx;
            b.y += b.vy;
            b.z += b.vz;

            b.vy += 0.5; // Schwerkraft zieht nach unten
            // b.vz verringert sich leicht (Luftwiderstand)
            b.vz *= 0.99;

            // Perspektive berechnen (2.5D)
            // Je größer Z, desto weiter weg, desto kleiner der Ball
            // Formel: scale = focalLength / (focalLength + z)
            const focalLength = 1000;
            const scale = focalLength / (focalLength + b.z);

            const drawRadius = b.radius * scale;

            // Bodenkollision (simuliert)
            if (b.y > height + 100) {
                balls.splice(i, 1); // Ball entfernen wenn aus dem Bild
                continue;
            }

            // Zeichnen
            ctx.beginPath();
            ctx.arc(b.x, b.y, Math.max(drawRadius, 1), 0, Math.PI * 2);
            ctx.fillStyle = b.color;
            ctx.fill();
            ctx.strokeStyle = "#333";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Pseudo-Schatten für 3D Effekt
            ctx.beginPath();
            ctx.arc(b.x + 5 * scale, b.y + 5 * scale, Math.max(drawRadius, 1) * 0.8, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0,0,0,0.1)";
            ctx.fill();


            // Verbesserte Kollisionserkennung (Durchgangsprüfung)
            if (!b.scored && b.prevZ < hoop.z && b.z >= hoop.z) {
                // Ball hat die Tiefe des Korbs durchquert
                // Interpoliere Position genau bei hoop.z
                const t = (hoop.z - b.prevZ) / (b.z - b.prevZ);
                const intersectX = b.prevX + (b.x - b.prevX) * t;
                const intersectY = b.prevY + (b.y - b.prevY) * t;

                // Prüfe Abstand zum Korbzentrum
                // Korb ist bei hoop.x, hoop.y
                // Ringradius ist hW / 2 (skaliert) -> aber wir rechnen im Weltraum (ungefähr)
                // Da hoop.x/y Bildschirmkoordinaten sind, müssen wir aufpassen.
                // Der Ball x/y sind auch Bildschirmkoordinaten (projiziert?).
                // Nein, Ball x/y sind Weltkoordinaten in diesem einfachen Modell, die direkt gezeichnet werden (mit Radius-Skalierung).
                // Moment: b.x wird direkt gezeichnet. Also sind b.x/b.y Bildschirmkoordinaten.
                // hoop.x/hoop.y sind auch Bildschirmkoordinaten.
                
                // Wir müssen prüfen, ob der Ball DURCH den Ring fällt.
                // Da wir von "vorne" werfen, muss der Ball von oben kommen?
                // Eigentlich ja, aber bei diesem einfachen 2.5D ist Y einfach Höhe.
                // Wenn b.vy > 0 (fällt nach unten) ist es ein Korb.
                
                if (b.vy > 0) {
                    const dist = Math.sqrt((intersectX - hoop.x) ** 2 + (intersectY - hoop.y) ** 2);
                    // Toleranzradius etwas kleiner als Ringbreite
                    if (dist < (hoop.width * depthScale / 2) * 0.8) {
                        score++;
                        b.scored = true;
                        b.color = "#0f0"; // Visuelles Feedback
                        document.getElementById('score').innerText = score;
                    }
                }
            }
        }

        requestAnimationFrame(update);
    }

    update();
}

// ==========================================
// TEIL 2: MOBILE CONTROLLER LOGIC
// ==========================================
function initController(hostId) {
    document.getElementById('controller-screen').style.display = 'flex';
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('btn-connect');
    const debugEl = document.getElementById('debug');
    const visualBall = document.getElementById('visual-feedback');

    const peer = new Peer(null, peerConfig);
    let conn = null;

    // PeerJS Verbindung aufbauen
    peer.on('open', (id) => {
        statusEl.innerText = "Verbinde mit Desktop...";
        conn = peer.connect(hostId);

        conn.on('open', () => {
            statusEl.innerText = "Verbunden! Bereit zum Werfen.";
            statusEl.style.color = "#0f0";
            btn.innerText = "Sensoren neu kalibrieren"; // Button ändert Zweck
        });

        conn.on('error', (err) => {
            statusEl.innerText = "Fehler: " + err;
        });
    });

    // Sensoren Logik
    let throwThreshold = 15; // Schwellenwert für Wurferkennung (m/s^2)
    let canThrow = true;

    // iOS 13+ benötigt explizite Erlaubnis für Sensoren
    btn.addEventListener('click', () => {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission()
                .then(response => {
                    if (response == 'granted') {
                        startSensors();
                    } else {
                        alert("Sensoren müssen erlaubt sein!");
                    }
                })
                .catch(console.error);
        } else {
            // Android oder älteres iOS
            startSensors();
        }
    });

    function startSensors() {
        window.addEventListener('devicemotion', handleMotion);
        statusEl.innerText = "Sensoren aktiv. Wirf!";
    }

    let tiltLR = 0; // Neigung links/rechts

    // Gyro/Orientation für die Richtung (Gamma: -90 bis 90)
    window.addEventListener('deviceorientation', (event) => {
        // Wir nutzen Gamma (Neigung links/rechts) zum Zielen
        if (event.gamma) {
            tiltLR = event.gamma;
            // Visuelles Feedback auf dem Handy
            visualBall.style.transform = `translateX(${tiltLR}px)`;
        }
    });

    function handleMotion(event) {
        if (!conn) return;

        const acc = event.acceleration; // Beschleunigung ohne Gravitation
        if (!acc) return;

        // Wirf-Logik:
        // Wir suchen nach einer starken Beschleunigung nach "vorne" (Z) und "oben" (Y).
        // Bei Portrait-Mode:
        // +Y ist oben (Richtung Himmel, wenn Handy senkrecht)
        // -Z ist weg vom User (in den Bildschirm hinein) oder +Z (aus dem Bildschirm raus)
        // Das hängt vom Browser/OS ab. Wir nehmen den Betrag von Z.
        
        // Wir nehmen an, dass ein Wurf eine starke Beschleunigung in Z und Y hat.
        const forceZ = Math.abs(acc.z);
        const forceY = acc.y; 

        // Gesamtkraft für Threshold
        const totalForce = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);

        // Debug
        // debugEl.innerText = `Z: ${acc.z.toFixed(1)} | Y: ${acc.y.toFixed(1)} | Tot: ${totalForce.toFixed(1)}`;

        if (canThrow && totalForce > throwThreshold) {
            // Wurf erkannt!
            // Wir senden die Komponenten, um die Flugkurve zu berechnen
            
            // Nur werfen, wenn auch eine gewisse Vorwärts/Aufwärts-Komponente da ist
            if (forceZ > 5 || forceY > 5) {
                canThrow = false;

                conn.send({
                    type: 'throw',
                    forceZ: forceZ,
                    forceY: forceY,
                    direction: tiltLR
                });

                // Visuelles Feedback
                document.body.style.backgroundColor = "#555";
                setTimeout(() => { document.body.style.backgroundColor = "#333"; }, 100);

                // Cooldown
                setTimeout(() => {
                    canThrow = true;
                }, 800);
            }
        }
    }
}
