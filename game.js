/* =====================================================
   SNAKE X — Enhanced Game Engine
   Features:
    · Dash ability (SPACE)
    · Wall-pass (ghost) mode via blue item
    · Teleport via purple item
    · Slow-time via orange item
    · Enemy AI (chases snake head, multiple enemies)
    · Particles & visual polish
   ===================================================== */

"use strict";

// ─── Canvas Setup ─────────────────────────────────────
const canvas  = document.getElementById('game-canvas');
const ctx     = canvas.getContext('2d');

const CELL    = 24;
let COLS, ROWS;

function resizeCanvas() {
  const wrapper = document.querySelector('.canvas-wrapper');
  const maxW    = Math.min(wrapper.clientWidth  - 32, 720);
  const maxH    = Math.min(wrapper.clientHeight - 32, 600);
  COLS = Math.floor(maxW / CELL);
  ROWS = Math.floor(maxH / CELL);
  canvas.width  = COLS * CELL;
  canvas.height = ROWS * CELL;
}

// ─── Game State ───────────────────────────────────────
let snake, dir, nextDir, score, highScore, level, foodEaten;
let gameLoop, running, paused;
let items     = [];    // special items
let enemies   = [];    // enemy snakes / chasers
let particles = [];    // visual particles
let difficulty = 'normal';
let dashCooldown  = 0;
const DASH_CD_MAX = 180;  // frames
let ghostTimer    = 0;
let slowTimer     = 0;
let baseSpeed, currentSpeed;
let food;

// ─── Difficulty Settings ──────────────────────────────
const DIFF = {
  easy:   { speed: 120, enemyStart: 3, enemyAdd: 5, dashCd: 120 },
  normal: { speed: 100, enemyStart: 2, enemyAdd: 4, dashCd: 180 },
  hard:   { speed: 75,  enemyStart: 1, enemyAdd: 3, dashCd: 240 },
};

// ─── Color Palette ────────────────────────────────────
const COLORS = {
  bg:       '#070a14',
  grid:     'rgba(255,255,255,0.025)',
  snake:    ['#22c55e','#16a34a','#15803d'],
  snakeGlow:'#22c55e',
  head:     '#4ade80',
  food:     '#f87171',
  foodGlow: '#ef4444',
  ghost:    'rgba(147,197,253,0.8)',
  enemy:    ['#ef4444','#dc2626','#b91c1c'],
  enemyGlow:'#ef4444',
};

// ─── Item Types ───────────────────────────────────────
const ITEM_TYPES = {
  ghost:    { color: '#3b82f6', glow: '#60a5fa', symbol: '👻', label: '벽 통과', duration: 300 },
  slow:     { color: '#f97316', glow: '#fb923c', symbol: '🐌', label: '슬로우',  duration: 200 },
  teleport: { color: '#a855f7', glow: '#c084fc', symbol: '🔮', label: '텔레포트' },
  bonus:    { color: '#f59e0b', glow: '#fbbf24', symbol: '⭐', label: '보너스 점수' },
};

// ─────────────────────────────────────────────────────
// Public functions called by HTML
// ─────────────────────────────────────────────────────
window.selectDifficulty = function(d) {
  difficulty = d;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('diff-' + d).classList.add('active');
};

window.startGame = function() {
  showScreen('game-screen');
  resizeCanvas();
  init();
};

window.goToMenu = function() {
  stopGame();
  showScreen('start-screen');
};

window.resumeGame = function() {
  if (!paused) return;
  paused = false;
  document.getElementById('pause-overlay').classList.add('hidden');
  gameLoop = requestAnimationFrame(tick);
};

// ─── Init ─────────────────────────────────────────────
function init() {
  const cfg    = DIFF[difficulty];
  baseSpeed    = cfg.speed;
  currentSpeed = baseSpeed;

  snake    = [];
  dir      = { x: 1, y: 0 };
  nextDir  = { x: 1, y: 0 };
  score    = 0;
  level    = 1;
  foodEaten= 0;
  items    = [];
  enemies  = [];
  particles= [];
  running  = true;
  paused   = false;
  dashCooldown = 0;
  ghostTimer   = 0;
  slowTimer    = 0;

  highScore = parseInt(localStorage.getItem('snakex-hs-'+difficulty) || '0');
  updateHUD();

  // Build initial snake (3 segments)
  // snake[0] = head (rightmost), moving right → body extends to the LEFT
  const mx = Math.floor(COLS / 2);
  const my = Math.floor(ROWS / 2);
  for (let i = 0; i <= 2; i++) snake.push({ x: mx - i, y: my });

  placeFood();
  spawnEnemies(cfg.enemyStart);

  document.getElementById('pause-overlay').classList.add('hidden');
  document.getElementById('badge-ghost').classList.remove('active');
  document.getElementById('badge-slow').classList.remove('active');

  if (gameLoop) cancelAnimationFrame(gameLoop);
  lastTime = 0;
  accumulator = 0;
  gameLoop = requestAnimationFrame(tick);
}

function stopGame() {
  running = false;
  if (gameLoop) cancelAnimationFrame(gameLoop);
}

// ─── Timing ───────────────────────────────────────────
let lastTime    = 0;
let accumulator = 0;

function tick(now) {
  if (!running || paused) return;
  const dt = Math.min(now - (lastTime || now), 100);
  lastTime = now;
  accumulator += dt;

  const interval = slowTimer > 0 ? currentSpeed * 2 : currentSpeed;

  if (accumulator >= interval) {
    accumulator -= interval;
    update();
  }

  draw();
  gameLoop = requestAnimationFrame(tick);
}

// ─── Update ───────────────────────────────────────────
function update() {
  // Timers
  if (dashCooldown > 0) dashCooldown--;
  if (ghostTimer   > 0) { ghostTimer--;   if (ghostTimer === 0) document.getElementById('badge-ghost').classList.remove('active'); }
  if (slowTimer    > 0) { slowTimer--;    if (slowTimer === 0)  document.getElementById('badge-slow').classList.remove('active'); }

  updateDashUI();

  dir = { ...nextDir };

  // Move head
  let head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // Wall collision
  if (ghostTimer > 0) {
    // wrap around
    head.x = (head.x + COLS) % COLS;
    head.y = (head.y + ROWS) % ROWS;
  } else {
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      die('벽에 충돌했습니다'); return;
    }
  }

  // Self collision
  if (snake.some((s, i) => i > 0 && s.x === head.x && s.y === head.y)) {
    die('자신에게 충돌했습니다'); return;
  }

  snake.unshift(head);

  // Check food
  let ate = false;
  if (head.x === food.x && head.y === food.y) {
    ate = true;
    eatFood();
  }

  if (!ate) snake.pop();

  // Check special items
  items.forEach((item, idx) => {
    if (head.x === item.x && head.y === item.y) {
      eatItem(item, idx);
    }
  });

  // Particle update
  particles = particles.filter(p => { p.life--; return p.life > 0; });
  particles.forEach(p => {
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.05;
    p.vx *= 0.98;
  });

  // Item blink/expiry
  items.forEach(item => { item.timer--; });
  items = items.filter(item => item.timer > 0);

  // Update enemies
  updateEnemies();

  // Enemy collision with snake
  for (const e of enemies) {
    if (e.body[0].x === head.x && e.body[0].y === head.y) {
      die('적에게 잡혔습니다!'); return;
    }
    for (const seg of e.body) {
      if (seg.x === head.x && seg.y === head.y) {
        die('적의 몸통에 충돌했습니다'); return;
      }
    }
  }
}

// ─── Food & Items ─────────────────────────────────────
function placeFood() {
  food = randomEmpty();
  // Sometimes spawn special items
  if (foodEaten > 0 && foodEaten % 3 === 0) spawnItem();
}

function eatFood() {
  score += 10 * level;
  foodEaten++;
  spawnParticles(food.x * CELL + CELL/2, food.y * CELL + CELL/2, COLORS.foodGlow, 12);
  updateHUD();

  // Level up
  if (foodEaten % 8 === 0) {
    level++;
    currentSpeed = Math.max(40, baseSpeed - (level - 1) * 8);
    spawnEnemies(1);
    flashLevelUp();
  }

  // High score
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('snakex-hs-'+difficulty, highScore);
    updateHUD();
  }

  placeFood();
}

function spawnItem() {
  const types = Object.keys(ITEM_TYPES);
  const type  = types[Math.floor(Math.random() * types.length)];
  const pos   = randomEmpty();
  items.push({ ...pos, type, timer: 180 + Math.random() * 120 });
}

function eatItem(item, idx) {
  const def = ITEM_TYPES[item.type];
  spawnParticles(item.x * CELL + CELL/2, item.y * CELL + CELL/2, def.glow, 16);
  showToast(def.symbol + ' ' + def.label);

  switch(item.type) {
    case 'ghost':
      ghostTimer = def.duration;
      document.getElementById('badge-ghost').classList.add('active');
      break;
    case 'slow':
      slowTimer  = def.duration;
      document.getElementById('badge-slow').classList.add('active');
      break;
    case 'teleport': {
      const pos  = randomEmpty();
      // Move head of snake
      const tail = snake.pop();
      snake.unshift(pos);
      spawnParticles(pos.x * CELL + CELL/2, pos.y * CELL + CELL/2, '#a855f7', 20);
      break;
    }
    case 'bonus':
      score += 50 * level;
      updateHUD();
      break;
  }
  items.splice(idx, 1);
}

// ─── Enemies ──────────────────────────────────────────
function spawnEnemies(count) {
  for (let i = 0; i < count; i++) {
    // Spawn enemy far from snake, ensure body is within bounds
    let pos;
    do { pos = randomEmpty(true); } while (pos.x < 3);
    enemies.push({
      body: [
        { x: pos.x,     y: pos.y },
        { x: pos.x - 1, y: pos.y },
        { x: pos.x - 2, y: pos.y },
      ],
      dir:  { x: 1, y: 0 },
      moveTimer: 0,
      // speed: game-ticks between moves (higher = slower enemy)
      speed: 3 + Math.random() * 1.5,
      color: `hsl(${Math.floor(Math.random() * 30)}, 80%, 55%)`,
    });
  }
}

function updateEnemies() {
  enemies.forEach(enemy => {
    enemy.moveTimer++;
    // speed = ticks between moves; slowTimer doubles it (enemy slows down)
    const spd = slowTimer > 0 ? enemy.speed * 2.5 : enemy.speed;
    if (enemy.moveTimer < spd) return;
    enemy.moveTimer = 0;

    // Pathfind toward snake head
    const head     = snake[0];
    const eHead    = enemy.body[0];
    const possible = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }
    ];

    // Avoid reversing
    const anti = { x: -enemy.dir.x, y: -enemy.dir.y };

    let best = null, bestDist = Infinity;
    for (const d of possible) {
      if (d.x === anti.x && d.y === anti.y) continue;
      const nx = eHead.x + d.x;
      const ny = eHead.y + d.y;
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      // Avoid own body
      if (enemy.body.some(s => s.x === nx && s.y === ny)) continue;
      // Manhattan distance to snake head
      const dist = Math.abs(nx - head.x) + Math.abs(ny - head.y);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }

    if (!best) {
      // Random valid move
      const valid = possible.filter(d => {
        const nx = eHead.x + d.x, ny = eHead.y + d.y;
        return nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS;
      });
      best = valid[Math.floor(Math.random() * valid.length)] || { x: 0, y: 0 };
    }

    enemy.dir = best;
    const newHead = { x: eHead.x + best.x, y: eHead.y + best.y };
    enemy.body.unshift(newHead);
    enemy.body.pop();
  });
}

// ─── Dash ─────────────────────────────────────────────
function doDash() {
  if (dashCooldown > 0) return;
  dashCooldown = DIFF[difficulty].dashCd;
  // Move 3 extra steps instantly
  for (let i = 0; i < 3; i++) {
    let head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (ghostTimer > 0) {
      head.x = (head.x + COLS) % COLS;
      head.y = (head.y + ROWS) % ROWS;
    } else {
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) break;
    }
    if (snake.some((s, idx) => idx > 0 && s.x === head.x && s.y === head.y)) break;

    // Check food during dash
    if (head.x === food.x && head.y === food.y) {
      snake.unshift(head);
      eatFood();
    } else {
      snake.unshift(head);
      snake.pop();
    }

    spawnParticles(head.x * CELL + CELL/2, head.y * CELL + CELL/2, '#00e5ff', 4);
  }
}

// ─── Draw ─────────────────────────────────────────────
function draw() {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawParticles();
  drawItems();
  drawFood();
  drawSnake();
  drawEnemies();

  // Ghost vignette
  if (ghostTimer > 0) {
    const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.width*0.3, canvas.width/2, canvas.height/2, canvas.width*0.8);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(59,130,246,0.12)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawGrid() {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth   = 0.5;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * CELL, 0);
    ctx.lineTo(x * CELL, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * CELL);
    ctx.lineTo(canvas.width, y * CELL);
    ctx.stroke();
  }
}

function drawSnake() {
  const isGhost = ghostTimer > 0;

  snake.forEach((seg, i) => {
    const x = seg.x * CELL, y = seg.y * CELL;
    const ratio = 1 - i / snake.length;
    const size = i === 0 ? CELL - 1 : CELL - 2;
    const offset = i === 0 ? 0.5 : 1;

    // Glow for head
    if (i === 0) {
      ctx.save();
      ctx.shadowColor  = isGhost ? '#60a5fa' : COLORS.snakeGlow;
      ctx.shadowBlur   = 16;
    }

    const r = 6;
    ctx.fillStyle = isGhost ? `rgba(147,197,253,${0.4 + ratio * 0.4})` :
                              `hsl(${140 - i * 2}, 70%, ${30 + ratio * 20}%)`;
    roundRect(x + offset, y + offset, size, size, r);
    ctx.fill();

    if (i === 0) ctx.restore();

    // Eyes on head
    if (i === 0) drawEyes(seg, dir);
  });
}

function drawEyes(seg, d) {
  const cx = seg.x * CELL + CELL / 2;
  const cy = seg.y * CELL + CELL / 2;

  let e1, e2;
  if (d.x === 1)  { e1 = {x: cx+5, y: cy-4}; e2 = {x: cx+5, y: cy+4}; }
  if (d.x === -1) { e1 = {x: cx-5, y: cy-4}; e2 = {x: cx-5, y: cy+4}; }
  if (d.y === 1)  { e1 = {x: cx-4, y: cy+5}; e2 = {x: cx+4, y: cy+5}; }
  if (d.y === -1) { e1 = {x: cx-4, y: cy-5}; e2 = {x: cx+4, y: cy-5}; }

  [e1, e2].forEach(e => {
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.x + d.x, e.y + d.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  });
}

function drawEnemies() {
  enemies.forEach(enemy => {
    enemy.body.forEach((seg, i) => {
      const x = seg.x * CELL, y = seg.y * CELL;
      const ratio = 1 - i / enemy.body.length;

      ctx.save();
      if (i === 0) {
        ctx.shadowColor = COLORS.enemyGlow;
        ctx.shadowBlur  = 14;
      }

      ctx.fillStyle = `hsl(0, 75%, ${25 + ratio * 20}%)`;
      roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 5);
      ctx.fill();
      ctx.restore();

      if (i === 0) drawEnemyEyes(seg, enemy.dir);
    });

    // Threat indicator (pulsing ring around enemy head)
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
    const eh = enemy.body[0];
    ctx.save();
    ctx.strokeStyle = `rgba(239,68,68,${0.3 + 0.3 * pulse})`;
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur  = 10;
    ctx.beginPath();
    ctx.arc(eh.x * CELL + CELL/2, eh.y * CELL + CELL/2, CELL * (0.8 + 0.2 * pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

function drawEnemyEyes(seg, d) {
  const cx = seg.x * CELL + CELL / 2;
  const cy = seg.y * CELL + CELL / 2;
  let e1, e2;
  if (d.x === 1)  { e1 = {x: cx+5, y: cy-4}; e2 = {x: cx+5, y: cy+4}; }
  if (d.x === -1) { e1 = {x: cx-5, y: cy-4}; e2 = {x: cx-5, y: cy+4}; }
  if (d.y === 1)  { e1 = {x: cx-4, y: cy+5}; e2 = {x: cx+4, y: cy+5}; }
  if (d.y === -1) { e1 = {x: cx-4, y: cy-5}; e2 = {x: cx+4, y: cy-5}; }
  if (!e1) { e1 = {x: cx+5, y: cy-4}; e2 = {x: cx+5, y: cy+4}; }

  [e1, e2].forEach(e => {
    ctx.beginPath();
    ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fca5a5';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(e.x + d.x, e.y + d.y, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
  });
}

function drawFood() {
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
  const x = food.x * CELL + CELL / 2;
  const y = food.y * CELL + CELL / 2;
  const r = CELL / 2 - 2 + pulse * 2;

  ctx.save();
  ctx.shadowColor = COLORS.foodGlow;
  ctx.shadowBlur  = 16 + pulse * 8;

  const grad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
  grad.addColorStop(0, '#fca5a5');
  grad.addColorStop(1, '#ef4444');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawItems() {
  items.forEach(item => {
    const def   = ITEM_TYPES[item.type];
    const blink = item.timer < 60 ? (Math.sin(Date.now() * 0.02) > 0) : true;
    if (!blink) return;

    const x = item.x * CELL, y = item.y * CELL;
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.007);

    ctx.save();
    ctx.shadowColor = def.glow;
    ctx.shadowBlur  = 16 + pulse * 10;

    roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 8);
    ctx.fillStyle = def.color + '99';
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.restore();

    // Symbol
    ctx.font      = `${CELL * 0.6}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.symbol, x + CELL/2, y + CELL/2);
  });
}

function drawParticles() {
  particles.forEach(p => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ─── Helpers ──────────────────────────────────────────
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function randomEmpty(farFromSnake = false) {
  let pos;
  let tries = 0;
  do {
    pos = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    tries++;
  } while (
    tries < 200 && (
      snake.some(s => s.x === pos.x && s.y === pos.y) ||
      (food && food.x === pos.x && food.y === pos.y) ||
      items.some(i => i.x === pos.x && i.y === pos.y) ||
      enemies.some(e => e.body.some(s => s.x === pos.x && s.y === pos.y)) ||
      (farFromSnake && snake.length > 0 &&
        Math.abs(pos.x - snake[0].x) + Math.abs(pos.y - snake[0].y) < 8)
    )
  );
  return pos;
}

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 2;
    particles.push({
      x, y,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed - 1,
      size:  2 + Math.random() * 3,
      color,
      life:  20 + Math.floor(Math.random() * 20),
      maxLife: 40,
    });
  }
}

function updateHUD() {
  document.getElementById('score-display').textContent     = score;
  document.getElementById('highscore-display').textContent = highScore;
  document.getElementById('level-display').textContent     = level;
}

function updateDashUI() {
  const icon  = document.getElementById('ability-dash');
  const ratio = dashCooldown / DASH_CD_MAX;
  if (dashCooldown === 0) {
    icon.classList.add('ready');
    document.getElementById('badge-dash').classList.add('active');
  } else {
    icon.classList.remove('ready');
    document.getElementById('badge-dash').classList.remove('active');
  }
}

let toastTimeout;
function showToast(text) {
  let toast = document.getElementById('game-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'game-toast';
    toast.style.cssText = `
      position:fixed; top:80px; left:50%; transform:translateX(-50%);
      background:rgba(0,0,0,0.8); color:#fff; padding:10px 24px;
      border-radius:50px; font-family:'Outfit',sans-serif; font-size:15px;
      font-weight:600; letter-spacing:1px; z-index:999;
      border:1px solid rgba(255,255,255,0.15);
      backdrop-filter:blur(8px);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.opacity = '1';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.style.opacity = '0', 1500);
}

let levelFlash = false;
function flashLevelUp() {
  showToast(`🎉 레벨 ${level}! 적이 더 빨라졌습니다`);
}

// ─── Die ──────────────────────────────────────────────
function die(cause) {
  running = false;
  cancelAnimationFrame(gameLoop);
  spawnParticles(snake[0].x * CELL + CELL/2, snake[0].y * CELL + CELL/2, '#ef4444', 30);
  draw(); // one last frame with death particles

  setTimeout(() => {
    document.getElementById('final-score').textContent     = score;
    document.getElementById('final-highscore').textContent = highScore;
    document.getElementById('final-level').textContent     = level;
    document.getElementById('final-food').textContent      = foodEaten;
    document.getElementById('gameover-cause').textContent  = cause;

    const isNew = score >= highScore && score > 0;
    document.getElementById('new-record-badge').classList.toggle('hidden', !isNew);

    showScreen('gameover-screen');
  }, 600);
}

// ─── Screen Management ────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });
  const el = document.getElementById(id);
  el.style.display = 'flex';
  el.classList.add('active');
}

// ─── Input ────────────────────────────────────────────
const KEY_MAP = {
  ArrowUp:    { x: 0,  y: -1 },
  ArrowDown:  { x: 0,  y: 1  },
  ArrowLeft:  { x: -1, y: 0  },
  ArrowRight: { x: 1,  y: 0  },
  w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
  s: { x: 0, y: 1  }, S: { x: 0, y: 1  },
  a: { x: -1,y: 0  }, A: { x: -1,y: 0  },
  d: { x: 1, y: 0  }, D: { x: 1, y: 0  },
};

document.addEventListener('keydown', e => {
  if (KEY_MAP[e.key]) {
    e.preventDefault();
    const d = KEY_MAP[e.key];
    // Prevent reversing
    if (snake && snake.length > 1) {
      if (d.x !== -dir.x || d.y !== -dir.y) nextDir = d;
    } else {
      nextDir = d;
    }
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (running && !paused) doDash();
  }

  if (e.code === 'Escape') {
    e.preventDefault();
    if (!running) return;
    if (paused) {
      window.resumeGame();
    } else {
      paused = true;
      document.getElementById('pause-overlay').classList.remove('hidden');
    }
  }
});

// Mobile swipe support
let touchStartX = 0, touchStartY = 0;
canvas.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > Math.abs(dy)) {
    nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  } else {
    nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  }
  e.preventDefault();
}, { passive: false });

// Resize
window.addEventListener('resize', () => {
  if (document.getElementById('game-screen').classList.contains('active')) {
    resizeCanvas();
  }
});

// ─── Init HUD highscore on load ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const hs = localStorage.getItem('snakex-hs-normal') || '0';
  document.getElementById('highscore-display').textContent = hs;
});
