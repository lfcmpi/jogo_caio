# PRP: Arrow Royale — Multiplayer Battle Royale Game

**Gerado em:** 2026-03-02
**Confidence Score:** 9/10
**Origem:** prompt-arrow-royale.md (especificacao completa com schemas, formulas e section markers)

---

## 1. Core (OBRIGATORIO)

### Goal
Construir um jogo multiplayer battle royale em tempo real com servidor Node.js (Express + Socket.IO) e cliente single-file HTML/Canvas.

### Why
Jogo party-game para ate 40 jogadores com Game Master controlando fases, shrink zones e HP dos jogadores. Ideal para sessoes LAN/ngrok com espectador GM.

### What
Dois arquivos completos e executaveis:
1. **`server.js`** — Servidor Node.js com Express, Socket.IO, game loop a 60 TPS, physics, collision detection, power-ups, scoring system e GM controls
2. **`index.html`** — Cliente single-file com lobby, canvas renderer com camera system, HUD, kill feed, kill notifications, GM panel, leaderboard e input handlers

### Success Criteria
- [ ] `npm init -y && npm i express socket.io helmet && node server.js` inicia sem erros na porta 3000
- [ ] Jogador acessa `localhost:3000`, ve lobby, customiza nome/cor/hat, entra no jogo
- [ ] GM acessa `localhost:3000?gm=arrow-royale-gm`, ve painel de controle sem ser jogador
- [ ] Fases funcionam: lobby -> test -> playing -> ended -> reset -> test
- [ ] Movimento WASD com normalizacao diagonal funciona
- [ ] Flechas (click esquerdo, 1/sec) e fireballs (click direito, 5s cooldown) funcionam
- [ ] Colisao projectile-player aplica dano e mata corretamente
- [ ] Power-ups spawnam na inner zone e sao coletados corretamente (star/arrow/fireball/boots)
- [ ] Shrink zone usa formula de SUBTRACAO: `ORIGINAL_RADIUS - (shrinkCount * ORIGINAL_RADIUS * 0.05)`
- [ ] Tombstones com stick figure aparecem onde jogadores morreram
- [ ] Kill feed, kill notifications e kill sound (GM only) funcionam
- [ ] Leaderboard calcula scores corretamente com N = jogadores reais
- [ ] ZERO uso de innerHTML em todo o cliente — apenas textContent e createElement
- [ ] spawnX/spawnY definidos uma vez no join, nunca modificados, usados no reset

---

## 2. Context

### Codebase Analysis
```
Projeto greenfield — nenhum codigo existente.
Apenas especificacao em prompt-arrow-royale.md e analise em prompt-arrow-royale-analysis.md.
Nao ha package.json, node_modules, nem arquivos de codigo.
```

### AI Docs References
```
- Express: https://expressjs.com/en/4x/api.html
- Socket.IO v4: https://socket.io/docs/v4/
- Helmet: https://helmetjs.github.io/
- Canvas API: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
```

### External Documentation
```
- Socket.IO handshake query: socket.handshake.query para auth do GM
- Web Audio API: AudioContext + OscillatorNode para kill sound
- requestAnimationFrame: loop de renderizacao do cliente
```

### CLAUDE.md References
```
Nenhum CLAUDE.md encontrado no projeto.
```

---

## 3. Tree Structure

### Before (Current)
```
teste/
├── .claude/
│   └── settings.local.json
├── prompt-arrow-royale.md
└── prompt-arrow-royale-analysis.md
```

### After (Desired)
```
teste/
├── .claude/
│   └── settings.local.json
├── prompt-arrow-royale.md
├── prompt-arrow-royale-analysis.md
├── PRPs/
│   └── prps/
│       └── arrow-royale-prp.md
├── package.json          (gerado por npm init -y)
├── node_modules/         (gerado por npm install)
├── server.js             (CRIAR — servidor completo)
└── index.html            (CRIAR — cliente completo)
```

---

## 4. Known Gotchas

| Gotcha | Solucao |
|--------|---------|
| Shrink formula com multiplicacao (`*= 0.95`) em vez de subtracao | Formula explicita: `ORIGINAL_RADIUS - (shrinkCount * ORIGINAL_RADIUS * 0.05)` com min 200 |
| Movimento diagonal mais rapido (sqrt(2)) | Normalizar vetor (dx,dy) antes de aplicar speed |
| innerHTML causa XSS | NUNCA usar innerHTML/outerHTML/insertAdjacentHTML — apenas textContent + createElement |
| spawnX/spawnY sobrescritos no reset | Definir UMA VEZ no join, resetar para esses valores salvos |
| Scoring hardcoded para 40 jogadores | Usar N = players.size real para rankings |
| GM aparecendo como jogador | GM identificado por handshake query, sem player object, nao conta como jogador |
| Power-ups spawnam fora da zona shrinkada | Inner circle = metade do CURRENT radius (nao original) |
| Disconnect sem tratamento | Disconnect durante 'playing' = morte (deathCounter++, deathOrder) |
| Fireball cor off-by-one | Indice explicito: `FIREBALL_COLORS[fireballDamage - 2]` |
| Arquivo truncado por tamanho | Section markers obrigatorios em ambos os arquivos, implementar TUDO |
| Tombstone stick figure "peeing" — possivel recusa criativa | Coordenadas canvas explicitas fornecidas no prompt |
| Rate limiting bloqueando jogo legitimo | Client-side aim throttle 20/sec, server budget 60/sec |
| Tie-breaking no scoring | Ranks sequenciais (arbitrario mas consistente) |
| CSP bloqueando inline scripts | helmet({ contentSecurityPolicy: false }) |

---

## 5. Implementation Blueprint

### Data Models / Schemas

```javascript
// === Player Object (criado no join) ===
{
  id,                    // socket.id
  name,                  // string, <=16 chars, HTML stripped
  color,                 // one of ALLOWED_COLORS (16 cores)
  hat,                   // one of HATS (6 tipos)
  x, y,                  // posicao atual
  spawnX, spawnY,        // SET ONCE no join, NUNCA modificar
  hp, maxHp,             // maxHp definido por GM (10-60, default 20)
  alive: true,
  kills: 0, damageDealt: 0, points: 0,
  aimAngle: 0,           // radianos
  moveKeys: { w:false, a:false, s:false, d:false },
  speed: BASE_SPEED,     // 4
  arrowExtras: 0,        // 0-4
  fireballDamage: 2,     // base 2, max 7
  bootStacks: 0,         // 0-3, cada +33% speed
  immuneUntil: 0,        // timestamp Date.now()
  lastArrowTime: 0,      // para fire rate 1/sec
  fireballCooldownUntil: 0,
  deathOrder: 0,         // 0 = vivo
  roomAngle: 0           // angulo no spawn ring
}

// === Projectile ===
{ id, x, y, angle, speed: ARROW_SPEED, ownerId,
  type: 'arrow'|'fireball', damage, radius,
  distanceTraveled: 0, maxDistance: ARROW_MAX_DIST }

// === PowerUp ===
{ id, x, y, type: 'star'|'arrow'|'fireball'|'boots' }

// === Tombstone ===
{ x, y, victimName, killerName, killerColor }

// === GameState ===
{ phase: 'lobby',  // 'lobby' | 'test' | 'playing' | 'ended'
  players: new Map(), projectiles: [], powerups: [], tombstones: [],
  currentRadius: ORIGINAL_RADIUS, shrinkCount: 0, deathCounter: 0 }
```

### Constants (compartilhados server + client)
```javascript
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
```

### Phase State Machine
```
lobby  ->  test  ->  playing  ->  ended
             ^<--- reset ---<----/
```

### Integration Points
| Ponto | Arquivo | Modificacao |
|-------|---------|-------------|
| 1 | `server.js` | CRIAR — servidor completo com todas as sections |
| 2 | `index.html` | CRIAR — cliente completo com todas as sections |
| 3 | `package.json` | GERAR via `npm init -y && npm i express socket.io helmet` |

---

## 6. Tasks

### Task 1: Inicializar projeto Node.js
**Keywords:** create project, install dependencies
**Files:**
- `package.json` (create via npm)

**Description:**
Executar `npm init -y && npm i express socket.io helmet` no diretorio do projeto para gerar package.json e instalar dependencias.

**Validation:**
```bash
node -e "require('express'); require('socket.io'); require('helmet'); console.log('OK')"
```

---

### Task 2: Criar server.js completo
**Keywords:** create server, implement all sections, wire game loop
**Files:**
- `server.js` (create)

**Description:**
Criar servidor completo com TODAS as sections obrigatorias. O arquivo deve conter:

**Section markers obrigatorios (cada um como comentario no codigo):**
1. `// === SECTION: IMPORTS AND SETUP ===`
2. `// === SECTION: GAME STATE INITIALIZATION ===`
3. `// === SECTION: HELPER FUNCTIONS ===`
4. `// === SECTION: SOCKET.IO CONNECTION HANDLER ===`
5. `// === SECTION: GAME LOOP ===`
6. `// === SECTION: SERVER LISTEN ===`

**Detalhamento por section:**

**IMPORTS AND SETUP:**
- Express + http + Socket.IO + helmet
- helmet({ contentSecurityPolicy: false })
- app.disable('x-powered-by')
- CORS via env var ou '*'
- express.static(__dirname)

**GAME STATE INITIALIZATION:**
- Todas as constants (copiar bloco exato do prompt)
- GameState object com todos os campos do schema

**HELPER FUNCTIONS:**
- `getSpawnPosition(playerIndex, totalPlayers)` — angulo no spawn ring
- `sanitizeName(raw)` — strip HTML, trim, max 16 chars
- `isValidColor(c)`, `isValidHat(h)`, `isFiniteNumber(n)`
- `calculateScores(players)` — damage ranking + survival ranking + kills*5, usando N real
- `shrinkBattlefield()` — formula de SUBTRACAO, min 200, push players inside

**SOCKET.IO CONNECTION HANDLER:**
- GM detection via `socket.handshake.query.gm === GM_SECRET`
- MAX_PLAYERS check para non-GM
- Rate limiting: 60 events/sec por socket
- Player events: `join`, `keyDown`, `keyUp`, `aim`, `mouseDown`, `mouseUp`
- GM events: `gm:setHp`, `gm:test`, `gm:start`, `gm:reset`, `gm:shrink`
- `disconnect`: morte se playing + alive, remove do map
- `join`: validar name/color/hat, criar Player object, getSpawnPosition, setar spawnX/spawnY ONCE, emit `joined`
- `mouseDown` button 0: setar flag de firing, button 2: fireball
- `mouseUp` button 0: limpar flag de firing

**GAME LOOP (setInterval 1000/TICK_RATE):**
1. Movement (test/playing): WASD -> dx,dy -> NORMALIZAR diagonal -> apply speed com bootStacks
   - test phase: clamp FORA do battlefield (dist >= currentRadius)
   - playing phase: clamp DENTRO do battlefield (dist <= currentRadius)
2. Arrow firing: se firing flag + cooldown >= 1000ms, criar arrow principal + extras em offsets [+30,-30,+15,-15]
3. Fireball firing: flag-based, cooldown check, criar fireball com fireballDamage e cor FIREBALL_COLORS[damage-2]
4. Projectile movement: mover por speed*angle, incrementar distanceTraveled, remover se >= maxDistance ou fora do radius
5. Collision detection: projectile vs alive players (skip owner), check immune, apply damage, kill logic (deathCounter, deathOrder, tombstone, killEvent, killSound to GM, check winner)
6. Power-up spawning: a cada 5s se < MAX_ON_FIELD, posicao random em inner circle (currentRadius/2)
7. Power-up collection: alive player within PLAYER_RADIUS+15, aplicar efeito, remover
8. Broadcast state: emit 'state' com phase, currentRadius, shrinkCount, players array (mapped), projectiles, powerups, tombstones

**SERVER LISTEN:**
- `server.listen(3000, () => console.log('Arrow Royale on :3000'))`

**Pseudocode critico — Arrow firing:**
```
if (player.isFiring && now - player.lastArrowTime >= 1000) {
  player.lastArrowTime = now;
  // Main arrow at aimAngle
  createProjectile(player, player.aimAngle, 'arrow', 1, ARROW_RADIUS);
  // Extra arrows based on arrowExtras (0-4)
  const offsets = [Math.PI/6, -Math.PI/6, Math.PI/12, -Math.PI/12];
  for (let i = 0; i < player.arrowExtras; i++) {
    createProjectile(player, player.aimAngle + offsets[i], 'arrow', 1, ARROW_RADIUS);
  }
}
```

**Pseudocode critico — Scoring:**
```
function calculateScores(players) {
  const all = Array.from(players.values());
  const N = all.length;  // N REAL, nao 40!

  // Damage ranking: sort desc by damageDealt
  const byDamage = [...all].sort((a,b) => b.damageDealt - a.damageDealt);
  byDamage.forEach((p, i) => p.damageRankPts = N - i);

  // Survival ranking: alive (deathOrder=0) = rank 1, last to die = rank 2, etc.
  const bySurvival = [...all].sort((a,b) => a.deathOrder - b.deathOrder);
  bySurvival.forEach((p, i) => p.survivalRankPts = N - i);

  // Final: damageRankPts + survivalRankPts + (kills * 5)
  all.forEach(p => p.points = p.damageRankPts + p.survivalRankPts + (p.kills * 5));
}
```

**Validation:**
```bash
node -c server.js && echo "Syntax OK"
node -e "require('./server.js')" &
sleep 2 && curl -s http://localhost:3000 | head -5
kill %1
```

---

### Task 3: Criar index.html completo
**Keywords:** create client, implement all sections, wire canvas renderer
**Files:**
- `index.html` (create)

**Description:**
Criar cliente single-file com ALL CSS in `<style>`, ALL JS in `<script>`. ZERO dependencias externas alem do Socket.IO (servido pelo servidor).

**Section markers obrigatorios (cada um como comentario HTML ou JS):**
1. `<!-- === SECTION: HTML STRUCTURE === -->`
2. `<!-- === SECTION: CSS STYLES === -->`
3. `// === SECTION: SOCKET CONNECTION ===`
4. `// === SECTION: LOBBY LOGIC ===`
5. `// === SECTION: CANVAS RENDERER ===`
6. `// === SECTION: HUD OVERLAY ===`
7. `// === SECTION: KILL FEED ===`
8. `// === SECTION: KILL NOTIFICATION ===`
9. `// === SECTION: KILL SOUND ===`
10. `// === SECTION: GM PANEL ===`
11. `// === SECTION: PHASE BANNERS ===`
12. `// === SECTION: LEADERBOARD ===`
13. `// === SECTION: INPUT HANDLERS ===`

**Detalhamento por section:**

**HTML STRUCTURE:**
- `<div id="lobby">` — lobby overlay
- `<canvas id="game">` — game canvas
- `<div id="hud">` — HP, kills, points, damage
- `<div id="killfeed">` — top-right scrolling feed
- `<div id="killNotification">` — center screen fade message
- `<div id="phaseBanner">` — center screen phase text
- `<div id="gmPanel">` — GM controls
- `<div id="leaderboard">` — game over overlay

**CSS STYLES:**
- Canvas: width:100vw, height:100vh, background:#1a1a2e
- Lobby: centered card, dark bg, inputs, color swatches grid, hat buttons
- HUD: fixed top-left, semi-transparent black bg
- Kill feed: fixed top-right, max 5 messages, newest on top
- Kill notification: fixed center, 28px, white, text-shadow, transition opacity 3s
- Phase banner: fixed center, 48px, bold, white, text-shadow
- GM panel: fixed left side, scrollable player list, HP sliders, control buttons
- Leaderboard: centered overlay table

**SOCKET CONNECTION:**
```javascript
const params = new URLSearchParams(window.location.search);
const isGM = params.has('gm');
const socket = io({ query: isGM ? { gm: params.get('gm') } : {} });
```

**LOBBY LOGIC:**
- Name input (maxlength=16), 16 color swatches, 6 hat buttons
- "Join Battle" -> emit join { name, color, hat }
- On 'joined': hide lobby, show canvas + HUD
- GM: skip lobby, show GM panel
- REGRA: ZERO innerHTML — apenas textContent + createElement

**CANVAS RENDERER:**
- Camera system: player-centered com VIEW_RANGE, GM com zoom/pan
- Transform: translate(canvas.width/2, height/2) -> scale(zoom) -> translate(-cameraX, -cameraY)
- Draw order (requestAnimationFrame):
  1. Clear canvas
  2. Battlefield circle border (white stroke, current radius) + dashed original se shrunk
  3. Inner power-up zone circle (half current radius, dotted)
  4. Grid/background pattern
  5. Power-ups (star=yellow star, arrow=white triangle, fireball=red circle, boots=green boot)
  6. Tombstones: gray rect 40x50, "RIP", victim name, stick figure em killer color com coordenadas canvas explicitas
  7. Projectiles (arrows=thin lines, fireballs=thick colored circles com FIREBALL_COLORS)
  8. Players: filled circle + immune flicker + hat (crown/wizard/horns/halo/bandana) + name label + HP bar + aim line
  9. Danger zone (red tint entre current e original radius)

**HUD OVERLAY:**
- Top-left: HP bar + numbers, Kills, Points, Damage Dealt
- Update a cada frame via textContent

**KILL FEED:**
- On 'killEvent': createElement div, textContent = "${killer} killed ${victim}", prepend, max 5
- NUNCA innerHTML

**KILL NOTIFICATION:**
- On 'killEvent': textContent = "${killer} eliminated ${victim}", opacity=1, setTimeout opacity=0

**KILL SOUND (GM only):**
- On 'killSound': AudioContext + OscillatorNode, square wave 440->220Hz, 0.5s duration

**GM PANEL:**
- Apenas se isGM === true
- Player list: nome + cor + HP slider (10-60) + stats + alive status
- Botoes: Test Run, Start Round, Reset, Shrink Zone
- Zoom: scroll wheel
- Display: phase, alive count, total players

**PHASE BANNERS:**
- 'test': "Test Mode -- Practice in your room!" (3s)
- 'playing': "Battle Started!" (3s)
- 'ended': "Game Over!" + show leaderboard

**LEADERBOARD:**
- Full-screen overlay
- Table: Rank | Name | Kills | Kill Pts | Damage | Dmg Rank Pts | Survival Pts | Total
- Sorted by Total desc
- createElement + textContent ONLY

**INPUT HANDLERS:**
- WASD keydown/keyup -> emit keyDown/keyUp
- mousemove -> calcular angulo player->cursor em world coords, emit 'aim' (THROTTLED 20/sec)
- mousedown -> emit mouseDown { button: e.button } (only 0 or 2)
- mouseup -> emit mouseUp { button: e.button }
- contextmenu -> preventDefault
- GM: arrow keys pan, scroll wheel zoom

**Validation:**
```bash
# Verificar que nao ha innerHTML
grep -c "innerHTML" index.html  # deve ser 0
# Verificar sections existem
grep -c "SECTION:" index.html   # deve ser >= 13
```

---

### Task 4: Testar integracao server + client
**Keywords:** wire test, validate integration, verify gameplay
**Files:**
- `server.js` (verify)
- `index.html` (verify)

**Description:**
Verificar que ambos os arquivos funcionam juntos:

1. Instalar dependencias se nao instaladas
2. Iniciar servidor
3. Verificar que index.html e servido
4. Verificar que Socket.IO conecta
5. Verificar que nao ha erros de sintaxe
6. Verificar que todas as sections existem em ambos os arquivos

**Validation:**
```bash
# Syntax check
node -c server.js

# Verificar sections no server
grep -c "=== SECTION:" server.js  # deve ser >= 6

# Verificar sections no client
grep -c "SECTION:" index.html  # deve ser >= 13

# Verificar ZERO innerHTML
grep -c "innerHTML" index.html  # deve ser 0

# Verificar shrink formula correta (subtracao)
grep "ORIGINAL_RADIUS -" server.js  # deve encontrar a formula

# Verificar normalizacao diagonal
grep "Math.sqrt(dx \* dx + dy \* dy)" server.js  # deve encontrar

# Verificar spawnX/spawnY no schema
grep "spawnX" server.js  # deve encontrar

# Start server e verificar
cd /Users/luismartins/ia/claude/novos_projetos/teste
node server.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
kill %1
```

---

## 7. Validation Gating

### Level 1: Syntax & Style
```bash
# Server syntax
node -c server.js

# Verificar que index.html e HTML valido (basico)
head -1 index.html | grep -q "<!DOCTYPE html>" && echo "HTML OK"
```
**Criterio:** Zero syntax errors

### Level 2: Structural Verification
```bash
# Todas as sections do server existem
for section in "IMPORTS AND SETUP" "GAME STATE INITIALIZATION" "HELPER FUNCTIONS" "SOCKET.IO CONNECTION HANDLER" "GAME LOOP" "SERVER LISTEN"; do
  grep -q "$section" server.js && echo "OK: $section" || echo "MISSING: $section"
done

# Todas as sections do client existem
for section in "HTML STRUCTURE" "CSS STYLES" "SOCKET CONNECTION" "LOBBY LOGIC" "CANVAS RENDERER" "HUD OVERLAY" "KILL FEED" "KILL NOTIFICATION" "KILL SOUND" "GM PANEL" "PHASE BANNERS" "LEADERBOARD" "INPUT HANDLERS"; do
  grep -q "$section" index.html && echo "OK: $section" || echo "MISSING: $section"
done
```
**Criterio:** Todas as sections presentes

### Level 3: Security & Critical Rules
```bash
# ZERO innerHTML
grep -c "innerHTML" index.html  # MUST be 0
grep -c "outerHTML" index.html  # MUST be 0
grep -c "insertAdjacentHTML" index.html  # MUST be 0

# Shrink formula e subtracao
grep "ORIGINAL_RADIUS - " server.js | grep -v "multiplication"

# Normalizacao diagonal
grep -q "Math.sqrt" server.js && echo "Normalization present"

# spawnX nunca modificado apos criacao
# (verificacao manual — grep por atribuicoes a spawnX que nao sejam no join)
```
**Criterio:** Zero violacoes de seguranca, formulas criticas corretas

### Level 4: Integration Test
```bash
cd /Users/luismartins/ia/claude/novos_projetos/teste
npm install 2>/dev/null
node server.js &
SERVER_PID=$!
sleep 2

# Verificar que servidor responde
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)
echo "HTTP Status: $HTTP_CODE"  # deve ser 200

# Verificar que Socket.IO endpoint existe
SOCKET_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/socket.io/?EIO=4&transport=polling")
echo "Socket.IO Status: $SOCKET_CODE"  # deve ser 200

kill $SERVER_PID
```
**Criterio:** Servidor inicia, serve HTML, Socket.IO responde

---

## 8. Final Checklist

### Quality Gates
- [ ] All Level 1 validations pass (syntax check)
- [ ] All Level 2 validations pass (all sections present)
- [ ] All Level 3 validations pass (zero innerHTML, formulas corretas)
- [ ] All Level 4 validations pass (servidor inicia, HTTP 200, Socket.IO funciona)
- [ ] Shrink formula usa SUBTRACAO (nao multiplicacao)
- [ ] Movimento diagonal normalizado (length = 1 antes de speed)
- [ ] spawnX/spawnY definidos ONCE no join, NUNCA modificados
- [ ] GM nao e jogador (sem player object)
- [ ] Power-up inner circle = metade do CURRENT radius
- [ ] Scoring usa N = jogadores reais (nao 40 hardcoded)
- [ ] Disconnect durante 'playing' = morte
- [ ] Tombstones persistem ate reset
- [ ] Kill feed e leaderboard usam createElement + textContent
- [ ] Fireball color = FIREBALL_COLORS[fireballDamage - 2]
- [ ] Rate limiting: server 60/sec, client aim 20/sec
- [ ] Todas as 16 ALLOWED_COLORS disponiveis no lobby
- [ ] Todos os 6 HATS desenhados no canvas
- [ ] Kill sound toca apenas para GM

### Patterns to Avoid
- [ ] ZERO innerHTML/outerHTML/insertAdjacentHTML em index.html
- [ ] ZERO `currentRadius *= 0.95` (multiplicacao de shrink)
- [ ] ZERO movement sem normalizacao diagonal
- [ ] ZERO hardcoded N=40 no scoring
- [ ] ZERO spawnX/spawnY modificados fora do join
- [ ] ZERO GM como jogador no map de players
- [ ] ZERO `// ...` ou `/* remaining code */` — codigo completo
- [ ] ZERO truncacao de sections — todos os markers presentes

---

## 9. Confidence Assessment

**Score:** 9/10

**Factors:**
- [+3] Especificacao extremamente detalhada com schemas, formulas e pseudocode
- [+2] Section markers explicitam exatamente o que implementar
- [+2] Formulas criticas fornecidas como codigo JavaScript copiavel
- [+1] Analise de failure modes ja feita (prompt-arrow-royale-analysis.md)
- [+1] Stack simples (Express + Socket.IO + Canvas) sem dependencias complexas
- [-1] Arquivo index.html pode ser muito longo (1200+ linhas) — risco de truncacao

**Se score fosse < 7, faltaria:**
- N/A — especificacao e completa e auto-contida

---

*PRP generated by dev-kit:10-generate-prp*
*IMPORTANTE: Execute em nova instancia do Claude Code (use /clear antes de executar)*
