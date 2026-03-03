# Arrow Royale — Complete Build Prompt

Write TWO complete, runnable files. Do NOT truncate, abbreviate, or skip any section. Every section marker below MUST appear in your output with full implementation.

## OUTPUT FILES

**File 1: `server.js`** — Node.js server (Express + Socket.IO)
**File 2: `index.html`** — Complete single-file client (HTML + CSS + JS inline)

Install dependencies: `npm init -y && npm i express socket.io helmet`
Run: `node server.js` → serves on port 3000.

---

## CONSTANTS (define at top of server.js AND as client-side JS constants)

```javascript
const ORIGINAL_RADIUS = 2000;       // battlefield radius in px
const PLAYER_RADIUS = 18;           // player collision circle
const BASE_SPEED = 4;               // px per tick
const VIEW_RANGE = 800;             // px radius each player can see
const ARROW_SPEED = 8;              // 2× BASE_SPEED
const ARROW_MAX_DIST = 400;         // ½ VIEW_RANGE
const ARROW_RADIUS = 3;             // collision radius
const FIREBALL_RADIUS = 12;         // much thicker than arrow
const FIREBALL_COOLDOWN = 5000;     // ms
const POWERUP_SPAWN_INTERVAL = 5000;// ms
const POWERUP_MAX_ON_FIELD = 3;
const MAX_PLAYERS = 40;
const TICK_RATE = 60;               // server ticks/sec
const GM_SECRET = 'arrow-royale-gm';// change this in production
const SPAWN_RING_RADIUS = ORIGINAL_RADIUS + 200; // holdout room distance from center

const ALLOWED_COLORS = [
  '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4',
  '#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#dcbeff',
  '#9A6324','#800000','#aaffc3','#000075'
]; // 16 colors

const HATS = ['none','crown','wizard','horns','halo','bandana']; // 6 types

const FIREBALL_COLORS = ['#ff0000','#ff7f00','#ffff00','#00ff00','#0000ff','#4b0082','#8b00ff'];
// Index: fireballDamage - 2. damage=2→red, 3→orange, 4→yellow, 5→green, 6→blue, 7→indigo, 8→violet (cap at 7 upgrades total unreachable, max usable index = 5 for damage 7)
```

---

## DATA SCHEMAS (server-side, used to build game state)

```javascript
// Player object — created on join
{
  id,                   // socket.id
  name,                 // string, ≤16 chars, HTML stripped
  color,                // one of ALLOWED_COLORS
  hat,                  // one of HATS
  x, y,                 // current position
  spawnX, spawnY,        // SET ONCE at join, NEVER modified — used by reset
  hp, maxHp,            // maxHp set by GM (10–60, default 20), hp ≤ maxHp
  alive: true,
  kills: 0, damageDealt: 0, points: 0,
  aimAngle: 0,          // radians
  moveKeys: { w:false, a:false, s:false, d:false },
  speed: BASE_SPEED,
  arrowExtras: 0,       // 0–4, extra arrow count
  fireballDamage: 2,    // base damage, upgrades to max 7
  bootStacks: 0,        // 0–3, each adds 33% speed
  immuneUntil: 0,       // timestamp (Date.now()), 0 = not immune
  lastArrowTime: 0,     // for 1/sec fire rate
  fireballCooldownUntil: 0,
  deathOrder: 0,        // 0 = alive. 1 = first to die, 2 = second, etc.
  roomAngle: 0          // radian angle on spawn ring
}

// Projectile
{ id, x, y, angle, speed: ARROW_SPEED, ownerId, type: 'arrow'|'fireball',
  damage, radius, distanceTraveled: 0, maxDistance: ARROW_MAX_DIST }

// PowerUp
{ id, x, y, type: 'star'|'arrow'|'fireball'|'boots' }

// Tombstone
{ x, y, victimName, killerName, killerColor }

// GameState
{ phase: 'lobby',  // valid: 'lobby' | 'test' | 'playing' | 'ended'
  players: new Map(), projectiles: [], powerups: [], tombstones: [],
  currentRadius: ORIGINAL_RADIUS, shrinkCount: 0, deathCounter: 0 }
```

---

## PHASE STATE MACHINE

```
lobby  →  test  →  playing  →  ended
            ↑←——— reset ———←——↓
```

- **lobby**: Players join, customize, wait. No movement.
- **test**: Players can move ONLY within their holdout area (enforce: distance from center must stay > currentRadius - 10). Doors closed.
- **playing**: Doors open. Players can enter battlefield. Combat active. Power-ups spawn.
- **ended**: Last player alive. Scores calculated. Leaderboard shown.
- **reset** (from test, playing, or ended): All players teleport to spawnX/spawnY. HP restored to maxHp. All upgrades cleared (arrowExtras=0, fireballDamage=2, bootStacks=0, immuneUntil=0). Projectiles, powerups, tombstones cleared. currentRadius reset to ORIGINAL_RADIUS, shrinkCount=0. Phase becomes 'test'.

---

## SERVER.JS — SECTION STRUCTURE

You MUST implement every section below. Mark each with a comment.

### // === SECTION: IMPORTS AND SETUP ===
```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // CSP false because inline scripts
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || '*' } });
app.use(express.static(__dirname)); // serves index.html
```

### // === SECTION: GAME STATE INITIALIZATION ===
Initialize GameState object with all fields from schema above.

### // === SECTION: HELPER FUNCTIONS ===

**Spawn position calculation:**
```javascript
function getSpawnPosition(playerIndex, totalPlayers) {
  const angle = (2 * Math.PI * playerIndex) / Math.max(totalPlayers, 1);
  return {
    x: Math.cos(angle) * SPAWN_RING_RADIUS,
    y: Math.sin(angle) * SPAWN_RING_RADIUS,
    roomAngle: angle
  };
}
```

**Input sanitization:**
```javascript
function sanitizeName(raw) {
  return String(raw).replace(/<[^>]*>/g, '').trim().substring(0, 16) || 'Player';
}
function isValidColor(c) { return ALLOWED_COLORS.includes(c); }
function isValidHat(h) { return HATS.includes(h); }
function isFiniteNumber(n) { return typeof n === 'number' && isFinite(n); }
```

**Scoring (call on game end):**
```javascript
function calculateScores(players) {
  const all = Array.from(players.values());
  const N = all.length;
  // Damage ranking: sort desc by damageDealt, rank 1→N, points = N+1-rank
  // Survival ranking: sort by deathOrder (0=alive=last), points = N+1-rank
  // Final = damageRank + survivalRank + (kills × 5)
}
```

**Shrink formula (CRITICAL — do NOT use multiplication):**
```javascript
function shrinkBattlefield() {
  state.shrinkCount++;
  state.currentRadius = ORIGINAL_RADIUS - (state.shrinkCount * ORIGINAL_RADIUS * 0.05);
  if (state.currentRadius < 200) state.currentRadius = 200; // minimum
  // Push players inside: for each alive player
  for (const p of state.players.values()) {
    if (!p.alive) continue;
    const dist = Math.sqrt(p.x * p.x + p.y * p.y);
    if (dist > state.currentRadius) {
      // Teleport to nearest point on new border
      const angle = Math.atan2(p.y, p.x);
      p.x = Math.cos(angle) * (state.currentRadius - PLAYER_RADIUS);
      p.y = Math.sin(angle) * (state.currentRadius - PLAYER_RADIUS);
    }
  }
}
```

### // === SECTION: SOCKET.IO CONNECTION HANDLER ===

**On connection:**
- Check if `socket.handshake.query.gm === GM_SECRET` → mark as game master (isGM = true, not a player)
- If not GM and players.size >= MAX_PLAYERS → reject with error event, disconnect
- Rate limiting: track event count per socket, max 60/sec. Reset counter every second. If exceeded, ignore event.

**Player events (only if NOT GM):**
- `join` { name, color, hat } → validate all three. Create Player object. Assign spawn position using getSpawnPosition(index, MAX_PLAYERS). Set spawnX, spawnY. Emit `joined` with player id.
- `keyDown` / `keyUp` { key } → validate key is one of 'w','a','s','d'. Update moveKeys.
- `aim` { angle } → validate isFiniteNumber. Store aimAngle.
- `mouseDown` { button } → validate button is 0 or 2.
  - button 0 (left): start arrow firing flag
  - button 2 (right): fire fireball if cooldown expired
- `mouseUp` { button } → stop arrow firing flag

**Game Master events (only if isGM):**
- `gm:setHp` { playerId, hp } → validate hp 10–60, set player.maxHp and player.hp
- `gm:test` → set phase = 'test'
- `gm:start` → set phase = 'playing'
- `gm:reset` → execute full reset as described in state machine
- `gm:shrink` → call shrinkBattlefield()

**On disconnect:**
- If player is alive and phase is 'playing': count as death (increment deathCounter, set deathOrder)
- Remove from players map

### // === SECTION: GAME LOOP (setInterval at TICK_RATE) ===

Each tick:

**1. Movement (only in 'test' or 'playing' phase):**
```javascript
// Calculate dx, dy from moveKeys
let dx = 0, dy = 0;
if (p.moveKeys.w) dy -= 1;
if (p.moveKeys.s) dy += 1;
if (p.moveKeys.a) dx -= 1;
if (p.moveKeys.d) dx += 1;
// NORMALIZE diagonal movement
const len = Math.sqrt(dx * dx + dy * dy);
if (len > 0) { dx /= len; dy /= len; }
// Apply speed with boot bonus
const speed = p.speed * (1 + p.bootStacks * 0.33);
p.x += dx * speed;
p.y += dy * speed;
```
- In 'test' phase: clamp player to stay outside battlefield (dist from center ≥ currentRadius)
- In 'playing' phase: clamp player to stay inside battlefield (dist from center ≤ currentRadius)

**2. Arrow firing:** If player is firing (left mouse held) and Date.now() - lastArrowTime ≥ 1000:
- Create main arrow projectile at player position, traveling at aimAngle
- Create extra arrows at offsets: [+30°, -30°, +15°, -15°] based on arrowExtras count (1→first offset, 2→first two offsets, etc.)
- Each arrow: damage = 1

**3. Fireball firing:** On right-click if Date.now() ≥ fireballCooldownUntil:
- Create fireball at player position, aimAngle, damage = fireballDamage, radius = FIREBALL_RADIUS
- Color determined by FIREBALL_COLORS[fireballDamage - 2]
- Set fireballCooldownUntil = Date.now() + FIREBALL_COOLDOWN

**4. Projectile movement:** For each projectile:
- Move by speed in angle direction
- distanceTraveled += speed
- If distanceTraveled ≥ maxDistance → remove
- If outside currentRadius → remove

**5. Collision detection:** For each projectile, check against all alive players (skip owner):
- If distance between projectile center and player center < projectile.radius + PLAYER_RADIUS:
  - If target player immuneUntil > Date.now() → skip (immune)
  - Apply damage: target.hp -= projectile.damage
  - owner.damageDealt += projectile.damage
  - Remove projectile
  - If target.hp ≤ 0:
    - target.alive = false
    - state.deathCounter++
    - target.deathOrder = state.deathCounter
    - owner.kills++
    - owner.points += 5 (kill bonus)
    - Create Tombstone { x: target.x, y: target.y, victimName: target.name, killerName: owner.name, killerColor: owner.color }
    - Emit `killEvent` to ALL sockets: { killer: owner.name, victim: target.name }
    - Emit `killSound` to GM socket only
    - Check if only 1 alive player remains → if so, phase = 'ended', calculateScores()

**6. Power-up spawning (only in 'playing' phase):**
- Every 5 seconds, if powerups.length < POWERUP_MAX_ON_FIELD:
  - Random position inside inner circle (radius = currentRadius / 2)
  - Random type from ['star', 'arrow', 'fireball', 'boots']
  - Add to powerups array

**7. Power-up collection:** For each powerup, check if any alive player is within PLAYER_RADIUS + 15:
  - 'star': player.immuneUntil = Date.now() + 10000
  - 'arrow': player.arrowExtras = Math.min(player.arrowExtras + 1, 4)
  - 'fireball': player.fireballDamage = Math.min(player.fireballDamage + 1, 7)
  - 'boots': player.bootStacks = Math.min(player.bootStacks + 1, 3)
  - Remove powerup

**8. Broadcast state:** Emit `state` to all sockets with:
```javascript
{
  phase, currentRadius, shrinkCount,
  players: Array.from(players.values()).map(p => ({
    id, name, color, hat, x, y, hp, maxHp, alive, kills, damageDealt, points,
    aimAngle, arrowExtras, fireballDamage, bootStacks,
    immune: p.immuneUntil > Date.now(), deathOrder
  })),
  projectiles, powerups, tombstones
}
```

### // === SECTION: SERVER LISTEN ===
`server.listen(3000, () => console.log('Arrow Royale on :3000'));`

---

## INDEX.HTML — SECTION STRUCTURE

Single HTML file. ALL CSS in `<style>`, ALL JS in `<script>`. You MUST implement every section.

### <!-- === SECTION: HTML STRUCTURE === -->

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Arrow Royale</title></head>
<body>
  <div id="lobby"><!-- lobby overlay --></div>
  <canvas id="game"></canvas>
  <div id="hud"><!-- HP, kills, points, damage --></div>
  <div id="killfeed"><!-- top-right scrolling feed --></div>
  <div id="killNotification"><!-- center screen fade message --></div>
  <div id="phaseBanner"><!-- center screen phase text --></div>
  <div id="gmPanel"><!-- game master controls, hidden for players --></div>
  <div id="leaderboard"><!-- game over overlay --></div>
</body>
</html>
```

### <!-- === SECTION: CSS STYLES === -->
- Full viewport canvas (width:100vw, height:100vh, background: #1a1a2e)
- Lobby: centered card with dark background, inputs, color swatches grid, hat buttons
- HUD: fixed top-left, semi-transparent black background
- Kill feed: fixed top-right, max 5 messages, newest on top
- Kill notification: fixed center, font-size 28px, white, text-shadow: 2px 2px 4px black, transition opacity 3s
- Phase banner: fixed center, font-size 48px, bold, white, text-shadow
- GM panel: fixed left side, scrollable player list with HP sliders, control buttons
- Leaderboard: centered overlay table with columns: Rank, Name, Kills, Damage, Kill Pts, Damage Rank, Survival Rank, Total

### <!-- === SECTION: SOCKET CONNECTION === -->
```javascript
const params = new URLSearchParams(window.location.search);
const isGM = params.has('gm');
const socket = io({ query: isGM ? { gm: params.get('gm') } : {} });
```

### <!-- === SECTION: LOBBY LOGIC === -->
- Name input (maxlength=16), color swatches (16 colored divs), hat selector (6 buttons)
- On "Join Battle" click: emit `join` with { name, color, hat }
- On `joined` event: hide lobby, show canvas + HUD
- If GM: skip lobby, show GM panel immediately
- ALL DOM text insertion uses `textContent` or `createElement`. NEVER use `innerHTML`.

### <!-- === SECTION: CANVAS RENDERER === -->

**Camera system:**
- Player view: canvas centered on own player position, VIEW_RANGE visible
- GM view: zoom variable (scroll wheel), pan with arrow keys. Zoom 1.0 = same as player. Zoom 0.1 = see entire field.
- Transform: `ctx.translate(canvas.width/2, canvas.height/2); ctx.scale(zoom, zoom); ctx.translate(-cameraX, -cameraY);`

**Draw order (every frame via requestAnimationFrame):**
1. Clear canvas
2. Draw battlefield circle border (white stroke, current radius). Draw dashed circle for original radius if shrunk.
3. Draw inner power-up zone circle (half current radius, faint dotted line)
4. Draw grid or subtle background pattern
5. Draw power-ups (colored shapes: star=yellow star shape, arrow=white triangle, fireball=red circle, boots=green boot shape)
6. Draw tombstones:
   - Gray rectangle (40×50px), "RIP" in white text at top, victim name below
   - Stick figure next to tombstone in killer's color:
     ```
     // Head: arc at (tombX+50, tombY-20), radius 5
     // Body: line from (tombX+50, tombY-15) to (tombX+50, tombY)
     // Legs: line from (tombX+50, tombY) to (tombX+44, tombY+12) and to (tombX+56, tombY+12)
     // Left arm: line from (tombX+50, tombY-10) to (tombX+42, tombY-5)
     // Right arm: line from (tombX+50, tombY-10) to (tombX+55, tombY-3)
     // Stream: small arc from (tombX+55, tombY-3) curving left toward tombstone
     // Killer name: small text below figure
     ```
7. Draw projectiles (arrows as thin lines/triangles, fireballs as thick colored circles using FIREBALL_COLORS)
8. Draw players (only alive ones):
   - Filled circle in player color, radius PLAYER_RADIUS
   - If immune: flicker visibility (skip drawing on alternating frames)
   - Hat on top (drawn with canvas shapes — crown: 3 yellow triangles; wizard: purple cone; horns: two curved red lines; halo: yellow ring above head; bandana: colored band across forehead)
   - Name label above (ctx.fillText, white with black shadow)
   - HP bar below (red/green proportional bar)
   - Aim direction indicator (thin line from center outward at aimAngle)
9. Draw battlefield border danger zone (if shrunk: red tinted ring between current and original radius)

### <!-- === SECTION: HUD OVERLAY === -->
- Top-left box: HP (bar + numbers), Kills, Points, Damage Dealt
- Update every frame from local player state
- ALL text set with `element.textContent = value`

### <!-- === SECTION: KILL FEED === -->
- On `killEvent` { killer, victim }:
  - Create div element, set textContent to `${killer} killed ${victim}`
  - Prepend to killfeed container
  - Keep max 5 entries, remove oldest
  - NEVER use innerHTML

### <!-- === SECTION: KILL NOTIFICATION === -->
- On `killEvent`:
  - Set notification div textContent to `${killer} eliminated ${victim}`
  - Set opacity to 1, then after 100ms set opacity to 0 (CSS transition handles fade over 3s)

### <!-- === SECTION: KILL SOUND (GM only) === -->
```javascript
// On 'killSound' event (GM only):
function playKillSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 440;
  osc.type = 'square';
  gain.gain.value = 0.3;
  osc.start();
  osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.3);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  osc.stop(ctx.currentTime + 0.5);
}
```

### <!-- === SECTION: GM PANEL === -->
Only render if `isGM === true`. Hidden for regular players.

**Controls:**
- Player list: for each player, show name + color swatch + HP slider (range 10–60) + current HP + damage dealt + kills + alive status
- Buttons (each emits corresponding GM event):
  - "Test Run" → `gm:test`
  - "Start Round" → `gm:start`
  - "Reset" → `gm:reset`
  - "Shrink Zone" → `gm:shrink` (show current radius and shrink count)
- Zoom: +/- buttons or scroll wheel
- Display: current phase, alive count, total players

### <!-- === SECTION: PHASE BANNERS === -->
- On phase change, show centered text for 3 seconds:
  - 'test' → "Test Mode — Practice in your room!"
  - 'playing' → "Battle Started!"
  - 'ended' → "Game Over!" + show leaderboard

### <!-- === SECTION: LEADERBOARD === -->
- Full-screen overlay on game end
- Table with columns: Rank | Name | Kills | Kill Pts | Damage | Dmg Rank Pts | Survival Pts | Total
- Sorted by Total descending
- Built with createElement/textContent (NO innerHTML)

### <!-- === SECTION: INPUT HANDLERS === -->
- WASD keydown/keyup → emit `keyDown`/`keyUp`
- mousemove → calculate angle from player to cursor in world coords, emit `aim` (THROTTLED: max 20 per second using timestamp check)
- mousedown → emit `mouseDown` { button: e.button } (only 0 or 2)
- mouseup → emit `mouseUp` { button: e.button }
- contextmenu → preventDefault (disable right-click menu)
- GM: arrow keys for pan, scroll wheel for zoom

---

## CRITICAL RULES — READ THESE LAST

1. **COMPLETE FILES.** Both files must be complete and runnable. Do NOT use `// ...` or `/* remaining code */` or any truncation. Every section marker above must appear in your code.
2. **textContent ONLY.** Never use innerHTML, outerHTML, or insertAdjacentHTML anywhere in the client. Every DOM text insertion must use textContent or createElement.
3. **Shrink formula is SUBTRACTION:** `currentRadius = ORIGINAL_RADIUS - (shrinkCount * ORIGINAL_RADIUS * 0.05)`. NOT multiplication.
4. **Normalize diagonal movement.** If both W+A are pressed, the movement vector must be normalized to length 1 before applying speed.
5. **Store spawnX/spawnY once at join. Never modify them.** Reset uses these saved coordinates.
6. **GM is not a player.** GM socket has no player object. GM sees everything, controls everything, plays nothing.
7. **Tombstones persist until reset.** They are part of game state broadcast to all clients.
8. **Power-up inner circle = half of CURRENT battlefield radius** (shrinks with battlefield).
9. **Scoring uses N (actual player count), not hardcoded 40.** If 15 players join, rankings go from 15 to 1.
10. **Disconnect during 'playing' = death.** Increment deathCounter, set deathOrder, remove player.
