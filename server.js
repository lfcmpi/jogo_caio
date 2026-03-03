// === SECTION: IMPORTS AND SETUP ===
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*' } });
app.use(express.static(__dirname));

// === SECTION: GAME STATE INITIALIZATION ===
const ORIGINAL_RADIUS = 2000;
const PLAYER_RADIUS = 18;
const BASE_SPEED = 4;
const VIEW_RANGE = 800;
const ARROW_SPEED = 8;
const ARROW_MAX_DIST = 400;
const ARROW_RADIUS = 3;
const FIREBALL_RADIUS = 12;
const FIREBALL_COOLDOWN = 5000;
const POWERUP_SPAWN_INTERVAL = 5000;
const POWERUP_MAX_ON_FIELD = 3;
const MAX_PLAYERS = 40;
const TICK_RATE = 60;
const GM_SECRET = 'arrow-royale-gm';
const SPAWN_RING_RADIUS = ORIGINAL_RADIUS + 200;

const ALLOWED_COLORS = [
  '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4',
  '#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#dcbeff',
  '#9A6324','#800000','#aaffc3','#000075'
];

const HATS = ['none','crown','wizard','horns','halo','bandana'];

const FIREBALL_COLORS = ['#ff0000','#ff7f00','#ffff00','#00ff00','#0000ff','#4b0082','#8b00ff'];

const state = {
  phase: 'lobby',
  players: new Map(),
  projectiles: [],
  powerups: [],
  tombstones: [],
  currentRadius: ORIGINAL_RADIUS,
  shrinkCount: 0,
  deathCounter: 0
};

let projectileIdCounter = 0;
let powerupIdCounter = 0;
let lastPowerupSpawn = 0;
let gmSocket = null;

// === SECTION: HELPER FUNCTIONS ===
function getSpawnPosition(playerIndex, totalPlayers) {
  const angle = (2 * Math.PI * playerIndex) / Math.max(totalPlayers, 1);
  return {
    x: Math.cos(angle) * SPAWN_RING_RADIUS,
    y: Math.sin(angle) * SPAWN_RING_RADIUS,
    roomAngle: angle
  };
}

function sanitizeName(raw) {
  return String(raw).replace(/<[^>]*>/g, '').trim().substring(0, 16) || 'Player';
}

function isValidColor(c) { return ALLOWED_COLORS.includes(c); }
function isValidHat(h) { return HATS.includes(h); }
function isFiniteNumber(n) { return typeof n === 'number' && isFinite(n); }

function calculateScores(players) {
  const all = Array.from(players.values());
  const N = all.length;
  if (N === 0) return;

  const byDamage = [...all].sort((a, b) => b.damageDealt - a.damageDealt);
  byDamage.forEach((p, i) => { p.damageRankPts = N - i; });

  const bySurvival = [...all].sort((a, b) => a.deathOrder - b.deathOrder);
  bySurvival.forEach((p, i) => { p.survivalRankPts = N - i; });

  all.forEach(p => {
    p.points = p.damageRankPts + p.survivalRankPts + (p.kills * 5);
  });
}

function shrinkBattlefield() {
  state.shrinkCount++;
  state.currentRadius = ORIGINAL_RADIUS - (state.shrinkCount * ORIGINAL_RADIUS * 0.05);
  if (state.currentRadius < 200) state.currentRadius = 200;
  for (const p of state.players.values()) {
    if (!p.alive) continue;
    const dist = Math.sqrt(p.x * p.x + p.y * p.y);
    if (dist > state.currentRadius) {
      const angle = Math.atan2(p.y, p.x);
      p.x = Math.cos(angle) * (state.currentRadius - PLAYER_RADIUS);
      p.y = Math.sin(angle) * (state.currentRadius - PLAYER_RADIUS);
    }
  }
}

function createProjectile(player, angle, type, damage, radius) {
  const maxDist = type === 'fireball' ? ARROW_MAX_DIST * 1.5 : ARROW_MAX_DIST;
  const speed = type === 'fireball' ? ARROW_SPEED * 0.75 : ARROW_SPEED;
  state.projectiles.push({
    id: ++projectileIdCounter,
    x: player.x,
    y: player.y,
    angle: angle,
    speed: speed,
    ownerId: player.id,
    type: type,
    damage: damage,
    radius: radius,
    distanceTraveled: 0,
    maxDistance: maxDist,
    color: type === 'fireball' ? FIREBALL_COLORS[Math.min(damage - 2, FIREBALL_COLORS.length - 1)] : null
  });
}

function resetGame() {
  for (const p of state.players.values()) {
    p.x = p.spawnX;
    p.y = p.spawnY;
    p.hp = p.maxHp;
    p.alive = true;
    p.kills = 0;
    p.damageDealt = 0;
    p.points = 0;
    p.arrowExtras = 0;
    p.fireballDamage = 2;
    p.bootStacks = 0;
    p.immuneUntil = 0;
    p.lastArrowTime = 0;
    p.fireballCooldownUntil = 0;
    p.deathOrder = 0;
    p.isFiring = false;
    p.moveKeys = { w: false, a: false, s: false, d: false };
    p.damageRankPts = 0;
    p.survivalRankPts = 0;
  }
  state.projectiles = [];
  state.powerups = [];
  state.tombstones = [];
  state.currentRadius = ORIGINAL_RADIUS;
  state.shrinkCount = 0;
  state.deathCounter = 0;
  state.phase = 'test';
}

function checkWinner() {
  if (state.phase !== 'playing') return;
  const alivePlayers = Array.from(state.players.values()).filter(p => p.alive);
  if (alivePlayers.length <= 1) {
    state.phase = 'ended';
    calculateScores(state.players);
    io.emit('phaseChange', 'ended');
  }
}

// === SECTION: SOCKET.IO CONNECTION HANDLER ===
const rateLimits = new Map();

setInterval(() => {
  rateLimits.clear();
}, 1000);

io.on('connection', (socket) => {
  const isGM = socket.handshake.query.gm === GM_SECRET;

  if (isGM) {
    gmSocket = socket;
    socket.emit('gmConnected');
  } else {
    if (state.players.size >= MAX_PLAYERS) {
      socket.emit('error', 'Server full');
      socket.disconnect(true);
      return;
    }
  }

  function rateLimit() {
    const count = rateLimits.get(socket.id) || 0;
    if (count >= 60) return true;
    rateLimits.set(socket.id, count + 1);
    return false;
  }

  if (!isGM) {
    socket.on('join', (data) => {
      if (rateLimit()) return;
      if (!data || typeof data !== 'object') return;
      if (state.players.has(socket.id)) return;

      const name = sanitizeName(data.name);
      const color = isValidColor(data.color) ? data.color : ALLOWED_COLORS[0];
      const hat = isValidHat(data.hat) ? data.hat : 'none';

      const playerIndex = state.players.size;
      const spawn = getSpawnPosition(playerIndex, MAX_PLAYERS);

      const player = {
        id: socket.id,
        name: name,
        color: color,
        hat: hat,
        x: spawn.x,
        y: spawn.y,
        spawnX: spawn.x,
        spawnY: spawn.y,
        hp: 20,
        maxHp: 20,
        alive: true,
        kills: 0,
        damageDealt: 0,
        points: 0,
        aimAngle: 0,
        moveKeys: { w: false, a: false, s: false, d: false },
        speed: BASE_SPEED,
        arrowExtras: 0,
        fireballDamage: 2,
        bootStacks: 0,
        immuneUntil: 0,
        lastArrowTime: 0,
        fireballCooldownUntil: 0,
        deathOrder: 0,
        roomAngle: spawn.roomAngle,
        isFiring: false,
        damageRankPts: 0,
        survivalRankPts: 0
      };

      state.players.set(socket.id, player);
      socket.emit('joined', { id: socket.id });
    });

    socket.on('keyDown', (data) => {
      if (rateLimit()) return;
      const player = state.players.get(socket.id);
      if (!player) return;
      if (data && typeof data.key === 'string') {
        const key = data.key.toLowerCase();
        if (key in player.moveKeys) {
          player.moveKeys[key] = true;
        }
      }
    });

    socket.on('keyUp', (data) => {
      if (rateLimit()) return;
      const player = state.players.get(socket.id);
      if (!player) return;
      if (data && typeof data.key === 'string') {
        const key = data.key.toLowerCase();
        if (key in player.moveKeys) {
          player.moveKeys[key] = false;
        }
      }
    });

    socket.on('aim', (data) => {
      if (rateLimit()) return;
      const player = state.players.get(socket.id);
      if (!player) return;
      if (data && isFiniteNumber(data.angle)) {
        player.aimAngle = data.angle;
      }
    });

    socket.on('mouseDown', (data) => {
      if (rateLimit()) return;
      const player = state.players.get(socket.id);
      if (!player || !player.alive) return;
      if (!data || typeof data.button !== 'number') return;

      if (data.button === 0) {
        player.isFiring = true;
      } else if (data.button === 2) {
        const now = Date.now();
        if (state.phase === 'playing' && now >= player.fireballCooldownUntil) {
          createProjectile(player, player.aimAngle, 'fireball', player.fireballDamage, FIREBALL_RADIUS);
          player.fireballCooldownUntil = now + FIREBALL_COOLDOWN;
        }
      }
    });

    socket.on('mouseUp', (data) => {
      if (rateLimit()) return;
      const player = state.players.get(socket.id);
      if (!player) return;
      if (data && data.button === 0) {
        player.isFiring = false;
      }
    });
  }

  if (isGM) {
    socket.on('gm:setHp', (data) => {
      if (!data || !data.playerId) return;
      const hp = parseInt(data.hp, 10);
      if (isNaN(hp) || hp < 10 || hp > 60) return;
      const player = state.players.get(data.playerId);
      if (player) {
        player.maxHp = hp;
        player.hp = Math.min(player.hp, hp);
      }
    });

    socket.on('gm:test', () => {
      if (state.phase === 'lobby' || state.phase === 'ended') {
        state.phase = 'test';
        io.emit('phaseChange', 'test');
      }
    });

    socket.on('gm:start', () => {
      if (state.phase === 'test') {
        state.phase = 'playing';
        io.emit('phaseChange', 'playing');
      }
    });

    socket.on('gm:reset', () => {
      resetGame();
      io.emit('phaseChange', 'test');
    });

    socket.on('gm:shrink', () => {
      if (state.phase === 'playing') {
        shrinkBattlefield();
      }
    });
  }

  socket.on('disconnect', () => {
    if (isGM) {
      gmSocket = null;
      return;
    }
    const player = state.players.get(socket.id);
    if (player && player.alive && state.phase === 'playing') {
      player.alive = false;
      state.deathCounter++;
      player.deathOrder = state.deathCounter;
      checkWinner();
    }
    state.players.delete(socket.id);
    rateLimits.delete(socket.id);
  });
});

// === SECTION: GAME LOOP ===
setInterval(() => {
  const now = Date.now();

  for (const p of state.players.values()) {
    if (!p.alive) continue;

    // 1. Movement (only in test or playing)
    if (state.phase === 'test' || state.phase === 'playing') {
      let dx = 0, dy = 0;
      if (p.moveKeys.w) dy -= 1;
      if (p.moveKeys.s) dy += 1;
      if (p.moveKeys.a) dx -= 1;
      if (p.moveKeys.d) dx += 1;

      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
      }

      const speed = p.speed * (1 + p.bootStacks * 0.33);
      p.x += dx * speed;
      p.y += dy * speed;

      const dist = Math.sqrt(p.x * p.x + p.y * p.y);

      if (state.phase === 'test') {
        if (dist < state.currentRadius) {
          const angle = Math.atan2(p.y, p.x);
          p.x = Math.cos(angle) * state.currentRadius;
          p.y = Math.sin(angle) * state.currentRadius;
        }
      } else if (state.phase === 'playing') {
        if (dist > state.currentRadius - PLAYER_RADIUS) {
          const angle = Math.atan2(p.y, p.x);
          p.x = Math.cos(angle) * (state.currentRadius - PLAYER_RADIUS);
          p.y = Math.sin(angle) * (state.currentRadius - PLAYER_RADIUS);
        }
      }
    }

    // 2. Arrow firing
    if (state.phase === 'playing' && p.isFiring && now - p.lastArrowTime >= 1000) {
      p.lastArrowTime = now;
      createProjectile(p, p.aimAngle, 'arrow', 1, ARROW_RADIUS);
      const offsets = [Math.PI / 6, -Math.PI / 6, Math.PI / 12, -Math.PI / 12];
      for (let i = 0; i < p.arrowExtras; i++) {
        createProjectile(p, p.aimAngle + offsets[i], 'arrow', 1, ARROW_RADIUS);
      }
    }
  }

  // 4. Projectile movement
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.x += Math.cos(proj.angle) * proj.speed;
    proj.y += Math.sin(proj.angle) * proj.speed;
    proj.distanceTraveled += proj.speed;

    if (proj.distanceTraveled >= proj.maxDistance) {
      state.projectiles.splice(i, 1);
      continue;
    }

    const projDist = Math.sqrt(proj.x * proj.x + proj.y * proj.y);
    if (projDist > state.currentRadius + 50) {
      state.projectiles.splice(i, 1);
      continue;
    }
  }

  // 5. Collision detection
  if (state.phase === 'playing') {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const proj = state.projectiles[i];
      let hit = false;

      for (const target of state.players.values()) {
        if (!target.alive) continue;
        if (target.id === proj.ownerId) continue;

        const dx = proj.x - target.x;
        const dy = proj.y - target.y;
        const distSq = dx * dx + dy * dy;
        const collisionDist = proj.radius + PLAYER_RADIUS;

        if (distSq < collisionDist * collisionDist) {
          if (target.immuneUntil > now) continue;

          target.hp -= proj.damage;
          const owner = state.players.get(proj.ownerId);
          if (owner) {
            owner.damageDealt += proj.damage;
          }

          hit = true;

          if (target.hp <= 0) {
            target.alive = false;
            state.deathCounter++;
            target.deathOrder = state.deathCounter;
            if (owner) {
              owner.kills++;
            }

            state.tombstones.push({
              x: target.x,
              y: target.y,
              victimName: target.name,
              killerName: owner ? owner.name : 'Unknown',
              killerColor: owner ? owner.color : '#ffffff'
            });

            io.emit('killEvent', {
              killer: owner ? owner.name : 'Unknown',
              victim: target.name
            });

            if (gmSocket) {
              gmSocket.emit('killSound');
            }

            checkWinner();
          }

          break;
        }
      }

      if (hit) {
        state.projectiles.splice(i, 1);
      }
    }
  }

  // 6. Power-up spawning (only in playing)
  if (state.phase === 'playing' && now - lastPowerupSpawn >= POWERUP_SPAWN_INTERVAL) {
    lastPowerupSpawn = now;
    if (state.powerups.length < POWERUP_MAX_ON_FIELD) {
      const innerRadius = state.currentRadius / 2;
      const angle = Math.random() * 2 * Math.PI;
      const dist = Math.random() * innerRadius;
      const types = ['star', 'arrow', 'fireball', 'boots'];
      state.powerups.push({
        id: ++powerupIdCounter,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        type: types[Math.floor(Math.random() * types.length)]
      });
    }
  }

  // 7. Power-up collection
  if (state.phase === 'playing') {
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const pu = state.powerups[i];
      let collected = false;

      for (const p of state.players.values()) {
        if (!p.alive) continue;
        const dx = pu.x - p.x;
        const dy = pu.y - p.y;
        const distSq = dx * dx + dy * dy;
        const collectionDist = PLAYER_RADIUS + 15;

        if (distSq < collectionDist * collectionDist) {
          switch (pu.type) {
            case 'star':
              p.immuneUntil = now + 10000;
              break;
            case 'arrow':
              p.arrowExtras = Math.min(p.arrowExtras + 1, 4);
              break;
            case 'fireball':
              p.fireballDamage = Math.min(p.fireballDamage + 1, 7);
              break;
            case 'boots':
              p.bootStacks = Math.min(p.bootStacks + 1, 3);
              break;
          }
          collected = true;
          break;
        }
      }

      if (collected) {
        state.powerups.splice(i, 1);
      }
    }
  }

  // 8. Broadcast state
  const playersArray = Array.from(state.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    hat: p.hat,
    x: p.x,
    y: p.y,
    hp: p.hp,
    maxHp: p.maxHp,
    alive: p.alive,
    kills: p.kills,
    damageDealt: p.damageDealt,
    points: p.points,
    aimAngle: p.aimAngle,
    arrowExtras: p.arrowExtras,
    fireballDamage: p.fireballDamage,
    bootStacks: p.bootStacks,
    immune: p.immuneUntil > now,
    deathOrder: p.deathOrder,
    damageRankPts: p.damageRankPts || 0,
    survivalRankPts: p.survivalRankPts || 0
  }));

  io.emit('state', {
    phase: state.phase,
    currentRadius: state.currentRadius,
    shrinkCount: state.shrinkCount,
    players: playersArray,
    projectiles: state.projectiles,
    powerups: state.powerups,
    tombstones: state.tombstones
  });

}, 1000 / TICK_RATE);

// === SECTION: SERVER LISTEN ===
server.listen(3000, () => console.log('Arrow Royale on :3000'));
