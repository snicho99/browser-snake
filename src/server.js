import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { createServer } from "node:http";
import QRCode from "qrcode";
import { Server } from "socket.io";

import { DEFAULT_BOTS_ENABLED, SnakeGame, TICK_MS } from "./game.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const app = express();
const server = createServer(app);
const io = new Server(server);

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "0.0.0.0";
const joinUrl = resolveJoinUrl({ port });
const scoreboardUrl = `${joinUrl}/leaderboard`;
const botsEnabled = process.env.ENABLE_AI_PLAYERS === "true" ? true : DEFAULT_BOTS_ENABLED;
const game = new SnakeGame({ joinUrl, scoreboardUrl, botsEnabled });
const qrDataUrlPromise = QRCode.toDataURL(joinUrl, {
  margin: 1,
  color: {
    dark: "#f7f3e8",
    light: "#132033"
  }
});

app.use(express.json());
app.use(express.static(publicDir));

app.get("/", (_request, response) => {
  response.sendFile(path.join(publicDir, "controller.html"));
});

app.get("/arena", (_request, response) => {
  response.sendFile(path.join(publicDir, "arena.html"));
});

app.get("/leaderboard", (_request, response) => {
  response.sendFile(path.join(publicDir, "leaderboard.html"));
});

app.get("/api/session", async (_request, response) => {
  response.json({
    ...game.getPublicConfig(),
    qrCodeDataUrl: await qrDataUrlPromise
  });
});

io.on("connection", (socket) => {
  game.attachSocket(socket);
  socket.emit("session-config", game.getPublicConfig());
  emitStates();

  socket.on("reconnect-intent", (payload) => {
    const player = game.reconnectPlayer(socket.id, payload?.playerId);
    if (player) {
      socket.emit("join-accepted", {
        player: serializePlayerForController(player),
        config: game.getPublicConfig()
      });
      emitStates();
    }
  });

  socket.on("join", (payload) => {
    const result = game.joinPlayer(socket.id, payload);
    if (!result.ok) {
      socket.emit("join-rejected", { reason: result.reason });
      return;
    }

    socket.emit("join-accepted", {
      player: serializePlayerForController(result.player),
      config: game.getPublicConfig()
    });
    emitStates();
  });

  socket.on("set-direction", (payload) => {
    game.setPendingDirection(socket.id, payload?.direction);
  });

  socket.on("set-scoring-mode", (payload) => {
    if (game.setScoringMode(payload?.mode)) {
      io.emit("scoring-mode-changed", { mode: payload.mode });
      emitStates();
    }
  });

  socket.on("disconnect", () => {
    game.detachSocket(socket.id);
    emitStates();
  });
});

setInterval(() => {
  const tickResult = game.tick(Date.now());

  if (tickResult.deaths.length > 0) {
    for (const playerId of tickResult.deaths) {
      const player = game.players.get(playerId);
      if (player?.socketId) {
        io.to(player.socketId).emit("player-died", {
          respawnAt: player.respawnAt
        });
      }
    }
  }

  emitStates(tickResult.gameState, tickResult.leaderboardState);
}, TICK_MS);

server.listen(port, host, () => {
  console.log(`Snake server listening on ${joinUrl}`);
  console.log(`Arena view: ${joinUrl}/arena`);
  console.log(`Leaderboard view: ${joinUrl}/leaderboard`);
});

function emitStates(gameState = game.getGameState(), leaderboardState = game.getLeaderboardState()) {
  io.emit("game-state", gameState);
  io.emit("leaderboard-state", leaderboardState);
}

function serializePlayerForController(player) {
  return {
    playerId: player.playerId,
    name: player.name,
    color: player.color,
    emoji: player.emoji,
    state: player.state,
    fruitCount: player.fruitCount,
    cumulativeScore: player.cumulativeScore
  };
}

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const network of Object.values(interfaces)) {
    for (const entry of network || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }

  return null;
}

function resolveJoinUrl({ port }) {
  if (process.env.JOIN_URL) {
    return process.env.JOIN_URL;
  }

  if (isFlyRuntime()) {
    const flyAppName = process.env.FLY_APP_NAME || "browser-snake";
    return `https://${flyAppName}.fly.dev`;
  }

  const lanIp = getLanIp() || "localhost";
  return `http://${lanIp}:${port}`;
}

function isFlyRuntime() {
  return Boolean(process.env.FLY_APP_NAME || process.env.FLY_REGION || process.env.FLY_ALLOC_ID);
}
