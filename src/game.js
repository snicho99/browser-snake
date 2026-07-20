import crypto from "node:crypto";

export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 18;
export const TICK_MS = 180;
export const SCORE_INTERVAL_MS = 1000;
export const BASE_LENGTH = 4;
export const RESPAWN_MS = 3000;
export const FRUIT_TARGET = 6;
export const MAX_NAME_LENGTH = 18;
export const MAX_PLAYERS = 9;
export const MIN_TOTAL_PLAYERS = 4;
export const DEFAULT_BOTS_ENABLED = false;

export const PLAYER_AVATARS = Object.freeze({
  "#ff6b6b": "😎",
  "#f39c4f": "🦊",
  "#ffe66d": "🐯",
  "#56d2c3": "🐸",
  "#6fa8ff": "🐙",
  "#c77dff": "🦄",
  "#ff8fab": "🐼",
  "#7bd389": "🐢",
  "#72ddf7": "🤖"
});

const SNAKE_EMOJIS = ["😎", "🤖", "👻", "🐸", "🦊", "🐼", "🐯", "🐵", "🦄", "🐙", "🐢", "🐲"];
const BOT_PROFILES = [
  { name: "Circuit", color: "#ff6b6b" },
  { name: "Glitch", color: "#56d2c3" },
  { name: "Pixel", color: "#ffe66d" },
  { name: "Vector", color: "#6fa8ff" },
  { name: "Nova", color: "#c77dff" },
  { name: "Comet", color: "#f39c4f" }
];

const DIRECTIONS = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};

const OPPOSITE_DIRECTION = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};

const SCORING_MODES = {
  longest: "Longest Now",
  fruit: "Most Fruit",
  cumulative: "Cumulative Score"
};

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function makeCellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function cloneCell(cell) {
  return { x: cell.x, y: cell.y };
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

function normalizeColor(color) {
  const value = String(color || "").trim();
  const normalized = /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
  return normalized && PLAYER_AVATARS[normalized] ? normalized : null;
}

function randomDirection() {
  return ["up", "right", "down", "left"][randomInt(4)];
}

function randomEmoji() {
  return SNAKE_EMOJIS[randomInt(SNAKE_EMOJIS.length)];
}

function avatarForColor(color) {
  return PLAYER_AVATARS[color];
}

function buildSnakeFromHead(head, direction, length) {
  const vector = DIRECTIONS[direction];
  const body = [];

  for (let index = 0; index < length; index += 1) {
    body.push({
      x: head.x - vector.x * index,
      y: head.y - vector.y * index
    });
  }

  return body;
}

export class SnakeGame {
  constructor({ joinUrl, scoreboardUrl, botsEnabled = DEFAULT_BOTS_ENABLED }) {
    this.joinUrl = joinUrl;
    this.scoreboardUrl = scoreboardUrl;
    this.botsEnabled = botsEnabled;
    this.players = new Map();
    this.sockets = new Map();
    this.fruits = [];
    this.scoringMode = "longest";
    this.lastScoreTickAt = Date.now();
    this.sessionStartedAt = Date.now();
    this.syncBotPlayers();
    this.ensureFruitCount();
  }

  attachSocket(socket) {
    this.sockets.set(socket.id, socket);
  }

  detachSocket(socketId) {
    this.sockets.delete(socketId);
    return this.removePlayerBySocketId(socketId);
  }

  getPublicConfig() {
    return {
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      tickMs: TICK_MS,
      baseLength: BASE_LENGTH,
      respawnMs: RESPAWN_MS,
      joinUrl: this.joinUrl,
      scoreboardUrl: this.scoreboardUrl,
      botsEnabled: this.botsEnabled,
      scoringModes: SCORING_MODES,
      activeScoringMode: this.scoringMode
    };
  }

  getPlayerBySocketId(socketId) {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) {
        return player;
      }
    }

    return null;
  }

  reconnectPlayer(socketId, playerId) {
    const player = this.players.get(playerId);
    if (!player || player.isBot) {
      return null;
    }

    player.socketId = socketId;
    player.connected = true;
    player.lastSeenAt = Date.now();
    return player;
  }

  removePlayerBySocketId(socketId) {
    const player = this.getPlayerBySocketId(socketId);
    if (!player) {
      return null;
    }

    this.players.delete(player.playerId);
    this.syncBotPlayers();
    return player;
  }

  isColorTaken(color, ignorePlayerId = null) {
    for (const player of this.players.values()) {
      if (player.playerId !== ignorePlayerId && player.color === color) {
        return true;
      }
    }

    return false;
  }

  countHumanPlayers() {
    return [...this.players.values()].filter((player) => !player.isBot).length;
  }

  countBotPlayers() {
    return [...this.players.values()].filter((player) => player.isBot).length;
  }

  syncBotPlayers(projectedHumanCount = this.countHumanPlayers()) {
    if (!this.botsEnabled) {
      for (const player of [...this.players.values()]) {
        if (player.isBot) {
          this.players.delete(player.playerId);
        }
      }
      return;
    }

    const desiredBots = Math.max(0, MIN_TOTAL_PLAYERS - projectedHumanCount);
    let currentBots = this.countBotPlayers();

    while (currentBots > desiredBots) {
      const bot = [...this.players.values()].reverse().find((player) => player.isBot);
      if (!bot) {
        break;
      }

      this.players.delete(bot.playerId);
      currentBots -= 1;
    }

    while (currentBots < desiredBots) {
      const bot = this.addBotPlayer();
      if (!bot) {
        break;
      }
      currentBots += 1;
    }
  }

  addBotPlayer() {
    const profile = BOT_PROFILES.find((candidate) => !this.isColorTaken(candidate.color));
    if (!profile) {
      return null;
    }

    const player = {
      playerId: crypto.randomUUID(),
      socketId: null,
      connected: true,
      isBot: true,
      name: profile.name,
      color: profile.color,
      state: "spawning",
      fruitCount: 0,
      cumulativeScore: 0,
      pendingDirection: null,
      respawnAt: Date.now(),
      snake: null,
      deaths: 0,
      emoji: avatarForColor(profile.color),
      lastSeenAt: Date.now()
    };

    this.players.set(player.playerId, player);
    this.tryRespawnPlayer(player, true);
    return player;
  }

  joinPlayer(socketId, payload) {
    this.syncBotPlayers(this.countHumanPlayers() + 1);

    const name = normalizeName(payload?.name);
    const color = normalizeColor(payload?.color);

    if (!name) {
      return { ok: false, reason: "Please enter a name." };
    }

    if (!color) {
      return { ok: false, reason: "Choose a valid color." };
    }

    const currentPlayerId = this.getPlayerBySocketId(socketId)?.playerId || null;
    if (this.isColorTaken(color, currentPlayerId)) {
      return { ok: false, reason: "That color is already taken." };
    }

    if (this.players.size >= MAX_PLAYERS) {
      return { ok: false, reason: "The arena is full right now." };
    }

    const existing = this.getPlayerBySocketId(socketId);
    if (existing) {
      existing.name = name;
      existing.color = color;
      existing.emoji = avatarForColor(color);
      return { ok: true, player: existing, created: false };
    }

    const player = {
      playerId: crypto.randomUUID(),
      socketId,
      connected: true,
      isBot: false,
      name,
      color,
      state: "spawning",
      fruitCount: 0,
      cumulativeScore: 0,
      pendingDirection: null,
      respawnAt: Date.now(),
      snake: null,
      deaths: 0,
      emoji: avatarForColor(color),
      lastSeenAt: Date.now()
    };

    this.players.set(player.playerId, player);
    this.tryRespawnPlayer(player, true);
    this.syncBotPlayers();
    return { ok: true, player, created: true };
  }

  setPendingDirection(socketId, direction) {
    const player = this.getPlayerBySocketId(socketId);
    if (!player || player.state !== "alive") {
      return;
    }

    if (!DIRECTIONS[direction]) {
      return;
    }

    player.pendingDirection = direction;
  }

  setScoringMode(mode) {
    if (!SCORING_MODES[mode]) {
      return false;
    }

    this.scoringMode = mode;
    return true;
  }

  tick(now = Date.now()) {
    this.syncBotPlayers();
    this.updateBotDirections();

    const deaths = [];
    const plans = new Map();
    const alivePlayers = [...this.players.values()].filter(
      (player) => player.state === "alive" && player.snake
    );

    for (const player of alivePlayers) {
      const snake = player.snake;
      const requestedDirection = player.pendingDirection;
      const currentDirection =
        requestedDirection && OPPOSITE_DIRECTION[snake.direction] !== requestedDirection
          ? requestedDirection
          : snake.direction;
      player.pendingDirection = null;

      const vector = DIRECTIONS[currentDirection];
      const nextHead = {
        x: snake.body[0].x + vector.x,
        y: snake.body[0].y + vector.y
      };

      const fruitIndex = this.fruits.findIndex((fruit) => fruit.x === nextHead.x && fruit.y === nextHead.y);
      const grows = fruitIndex >= 0;
      const nextBody = [nextHead, ...snake.body.map(cloneCell)];

      if (!grows) {
        nextBody.pop();
      }

      plans.set(player.playerId, {
        player,
        direction: currentDirection,
        nextHead,
        nextBody,
        grows,
        fruitIndex
      });
    }

    const occupiedCells = new Map();

    for (const [playerId, plan] of plans) {
      const currentTail = plan.player.snake.body[plan.player.snake.body.length - 1];
      const ignoreTail = !plan.grows ? makeCellKey(currentTail) : null;

      for (const segment of plan.player.snake.body) {
        const key = makeCellKey(segment);
        if (ignoreTail && key === ignoreTail) {
          continue;
        }

        const existing = occupiedCells.get(key) || [];
        existing.push(playerId);
        occupiedCells.set(key, existing);
      }
    }

    const headTargets = new Map();

    for (const [playerId, plan] of plans) {
      const targetKey = makeCellKey(plan.nextHead);
      const contenders = headTargets.get(targetKey) || [];
      contenders.push(playerId);
      headTargets.set(targetKey, contenders);
    }

    for (const [playerId, plan] of plans) {
      const { nextHead } = plan;
      const outOfBounds =
        nextHead.x < 0 ||
        nextHead.x >= GRID_WIDTH ||
        nextHead.y < 0 ||
        nextHead.y >= GRID_HEIGHT;

      const bodyCollision = occupiedCells.has(makeCellKey(nextHead));
      const contestedHead = (headTargets.get(makeCellKey(nextHead)) || []).length > 1;

      if (outOfBounds || bodyCollision || contestedHead) {
        deaths.push(playerId);
      }
    }

    for (const [playerId, plan] of plans) {
      if (deaths.includes(playerId)) {
        continue;
      }

      plan.player.snake = {
        ...plan.player.snake,
        direction: plan.direction,
        body: plan.nextBody,
        length: plan.nextBody.length,
        targetLength: plan.nextBody.length
      };
      plan.player.state = "alive";

      if (plan.grows) {
        plan.player.fruitCount += 1;
        this.fruits.splice(plan.fruitIndex, 1);
      }
    }

    for (const playerId of deaths) {
      const player = this.players.get(playerId);
      if (!player) {
        continue;
      }

      player.state = "respawning";
      player.snake = null;
      player.pendingDirection = null;
      player.respawnAt = now + RESPAWN_MS;
      player.deaths += 1;
    }

    this.ensureFruitCount();
    this.applyCumulativeScore(now);
    this.processRespawns(now);

    return {
      deaths,
      gameState: this.getGameState(now),
      leaderboardState: this.getLeaderboardState(now)
    };
  }

  updateBotDirections() {
    for (const player of this.players.values()) {
      if (!player.isBot || player.state !== "alive" || !player.snake) {
        continue;
      }

      player.pendingDirection = this.chooseBotDirection(player);
    }
  }

  chooseBotDirection(player) {
    const currentDirection = player.snake.direction;
    const directions = Object.keys(DIRECTIONS).filter(
      (direction) => OPPOSITE_DIRECTION[currentDirection] !== direction
    );
    const occupied = this.collectOccupiedCellsForBot(player);

    const rankedDirections = directions
      .map((direction) => ({
        direction,
        score: this.scoreBotDirection(player, direction, occupied)
      }))
      .sort((a, b) => b.score - a.score);

    const safeDirection = rankedDirections.find((entry) => entry.score > -10000);
    return safeDirection ? safeDirection.direction : currentDirection;
  }

  collectOccupiedCellsForBot(player) {
    const occupied = new Set();

    for (const other of this.players.values()) {
      if (!other.snake) {
        continue;
      }

      const tail = other.snake.body[other.snake.body.length - 1];

      for (const segment of other.snake.body) {
        if (other.playerId === player.playerId && segment.x === tail.x && segment.y === tail.y) {
          continue;
        }

        occupied.add(makeCellKey(segment));
      }
    }

    return occupied;
  }

  scoreBotDirection(player, direction, occupied) {
    const vector = DIRECTIONS[direction];
    const nextHead = {
      x: player.snake.body[0].x + vector.x,
      y: player.snake.body[0].y + vector.y
    };

    if (
      nextHead.x < 0 ||
      nextHead.x >= GRID_WIDTH ||
      nextHead.y < 0 ||
      nextHead.y >= GRID_HEIGHT ||
      occupied.has(makeCellKey(nextHead))
    ) {
      return -10000;
    }

    const nearestFruitDistance = this.fruits.reduce((best, fruit) => {
      const distance = Math.abs(fruit.x - nextHead.x) + Math.abs(fruit.y - nextHead.y);
      return Math.min(best, distance);
    }, Number.POSITIVE_INFINITY);

    let openNeighbors = 0;
    for (const candidate of Object.values(DIRECTIONS)) {
      const probe = { x: nextHead.x + candidate.x, y: nextHead.y + candidate.y };
      const inBounds =
        probe.x >= 0 &&
        probe.x < GRID_WIDTH &&
        probe.y >= 0 &&
        probe.y < GRID_HEIGHT;

      if (inBounds && !occupied.has(makeCellKey(probe))) {
        openNeighbors += 1;
      }
    }

    const keepsHeading = direction === player.snake.direction ? 0.35 : 0;
    const fruitBonus = Number.isFinite(nearestFruitDistance) ? 12 - nearestFruitDistance : 0;
    return openNeighbors * 4 + fruitBonus + keepsHeading;
  }

  applyCumulativeScore(now) {
    if (now - this.lastScoreTickAt < SCORE_INTERVAL_MS) {
      return;
    }

    const elapsedSteps = Math.floor((now - this.lastScoreTickAt) / SCORE_INTERVAL_MS);
    this.lastScoreTickAt += elapsedSteps * SCORE_INTERVAL_MS;

    for (const player of this.players.values()) {
      if (player.state === "alive" && player.snake) {
        player.cumulativeScore += player.snake.body.length * elapsedSteps;
      }
    }
  }

  processRespawns(now) {
    for (const player of this.players.values()) {
      if (player.state === "respawning" && player.respawnAt <= now) {
        this.tryRespawnPlayer(player, false);
      }
    }
  }

  tryRespawnPlayer(player, immediate) {
    const spawn = this.findSpawnPlacement();
    if (!spawn) {
      player.state = immediate ? "spawning" : "respawning";
      player.respawnAt = Date.now() + 1000;
      return false;
    }

    player.snake = {
      direction: spawn.direction,
      body: buildSnakeFromHead(spawn.head, spawn.direction, BASE_LENGTH),
      length: BASE_LENGTH,
      targetLength: BASE_LENGTH
    };
    player.state = "alive";
    player.respawnAt = 0;
    return true;
  }

  findSpawnPlacement() {
    const occupied = this.collectOccupiedCells();
    const attempts = 100;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const direction = randomDirection();
      const marginX = 4;
      const marginY = 4;
      const head = {
        x: marginX + randomInt(Math.max(1, GRID_WIDTH - marginX * 2)),
        y: marginY + randomInt(Math.max(1, GRID_HEIGHT - marginY * 2))
      };
      const body = buildSnakeFromHead(head, direction, BASE_LENGTH);

      const fits = body.every((cell) =>
        cell.x >= 0 &&
        cell.x < GRID_WIDTH &&
        cell.y >= 0 &&
        cell.y < GRID_HEIGHT &&
        !occupied.has(makeCellKey(cell))
      );

      if (fits) {
        return { head, direction };
      }
    }

    return null;
  }

  collectOccupiedCells() {
    const occupied = new Set();

    for (const player of this.players.values()) {
      if (!player.snake) {
        continue;
      }

      for (const segment of player.snake.body) {
        occupied.add(makeCellKey(segment));
      }
    }

    for (const fruit of this.fruits) {
      occupied.add(makeCellKey(fruit));
    }

    return occupied;
  }

  ensureFruitCount() {
    const occupied = this.collectOccupiedCells();

    while (this.fruits.length < FRUIT_TARGET) {
      const candidate = {
        x: randomInt(GRID_WIDTH),
        y: randomInt(GRID_HEIGHT)
      };
      const key = makeCellKey(candidate);

      if (occupied.has(key)) {
        continue;
      }

      this.fruits.push(candidate);
      occupied.add(key);
    }
  }

  getGameState(now = Date.now()) {
    return {
      grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
      joinUrl: this.joinUrl,
      players: [...this.players.values()].map((player) => ({
        playerId: player.playerId,
        name: player.name,
        color: player.color,
        isBot: player.isBot,
        state: player.state,
        fruitCount: player.fruitCount,
        cumulativeScore: player.cumulativeScore,
        deaths: player.deaths,
        emoji: player.emoji,
        respawnRemainingMs:
          player.state === "respawning" ? Math.max(0, player.respawnAt - now) : 0,
        snake: player.snake
          ? {
              direction: player.snake.direction,
              body: player.snake.body.map(cloneCell),
              length: player.snake.body.length
            }
          : null
      })),
      fruits: this.fruits.map(cloneCell),
      activeScoringMode: this.scoringMode,
      serverTime: now
    };
  }

  getLeaderboardState(now = Date.now()) {
    const rows = [...this.players.values()].map((player) => ({
      playerId: player.playerId,
      name: player.name,
      color: player.color,
      isBot: player.isBot,
      state: player.state,
      fruitCount: player.fruitCount,
      cumulativeScore: player.cumulativeScore,
      currentLength: player.snake ? player.snake.body.length : BASE_LENGTH,
      deaths: player.deaths,
      emoji: player.emoji,
      respawnRemainingMs:
        player.state === "respawning" ? Math.max(0, player.respawnAt - now) : 0
    }));

    const compareByMode = {
      longest: (a, b) => b.currentLength - a.currentLength || b.fruitCount - a.fruitCount,
      fruit: (a, b) => b.fruitCount - a.fruitCount || b.currentLength - a.currentLength,
      cumulative: (a, b) => b.cumulativeScore - a.cumulativeScore || b.currentLength - a.currentLength
    };

    rows.sort((a, b) => compareByMode[this.scoringMode](a, b));

    return {
      scoringMode: this.scoringMode,
      scoringModeLabel: SCORING_MODES[this.scoringMode],
      scoringModes: SCORING_MODES,
      rows,
      playerCount: rows.length,
      aliveCount: rows.filter((row) => row.state === "alive").length,
      serverTime: now,
      joinUrl: this.joinUrl
    };
  }
}
