const socket = io();
const canvas = document.getElementById("arenaCanvas");
const context = canvas.getContext("2d");
const qrCode = document.getElementById("qrCode");
const joinUrlNode = document.getElementById("joinUrl");
const playerList = document.getElementById("playerList");

let sessionConfig = null;
let currentGameState = null;
let previousGameState = null;
let lastStateAt = 0;

init();

async function init() {
  const response = await fetch("/api/session");
  sessionConfig = await response.json();
  qrCode.src = sessionConfig.qrCodeDataUrl;
  joinUrlNode.textContent = sessionConfig.joinUrl;
  joinUrlNode.href = sessionConfig.joinUrl;
  resizeCanvas();
  requestAnimationFrame(draw);
}

window.addEventListener("resize", resizeCanvas);

socket.on("game-state", (nextState) => {
  previousGameState = currentGameState;
  currentGameState = nextState;
  lastStateAt = performance.now();
  renderPlayers();
});

function resizeCanvas() {
  const stage = canvas.parentElement;
  const padding = 48;
  const width = stage.clientWidth - padding;
  const height = stage.clientHeight - padding;
  const aspect = 32 / 18;

  let canvasWidth = width;
  let canvasHeight = width / aspect;

  if (canvasHeight > height) {
    canvasHeight = height;
    canvasWidth = height * aspect;
  }

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvasWidth * ratio));
  canvas.height = Math.max(1, Math.floor(canvasHeight * ratio));
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function draw(now) {
  requestAnimationFrame(draw);

  if (!currentGameState) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cell = Math.min(width / currentGameState.grid.width, height / currentGameState.grid.height);
  const offsetX = (width - cell * currentGameState.grid.width) / 2;
  const offsetY = (height - cell * currentGameState.grid.height) / 2;
  const tickMs = sessionConfig?.tickMs || 180;
  const progress = Math.max(0, Math.min(1, (now - lastStateAt) / tickMs));

  context.clearRect(0, 0, width, height);

  context.fillStyle = "#071019";
  roundRect(context, 0, 0, width, height, 28);
  context.fill();

  context.save();
  context.translate(offsetX, offsetY);

  const worldWidth = cell * currentGameState.grid.width;
  const worldHeight = cell * currentGameState.grid.height;
  const worldGradient = context.createLinearGradient(0, 0, worldWidth, worldHeight);
  worldGradient.addColorStop(0, "#102238");
  worldGradient.addColorStop(1, "#0a1625");
  context.fillStyle = worldGradient;
  context.fillRect(0, 0, worldWidth, worldHeight);

  drawGrid(cell, currentGameState.grid.width, currentGameState.grid.height);

  for (const fruit of currentGameState.fruits) {
    drawFruit(fruit, cell, progress);
  }

  for (const player of currentGameState.players) {
    if (!player.snake) {
      continue;
    }

    const previousPlayer = previousGameState?.players.find((entry) => entry.playerId === player.playerId);
    drawSnake(player, previousPlayer, cell, progress);
  }

  context.restore();
}

function drawGrid(cell, width, height) {
  context.strokeStyle = "rgba(255,255,255,0.035)";
  context.lineWidth = 1;

  for (let x = 0; x <= width; x += 1) {
    context.beginPath();
    context.moveTo(x * cell, 0);
    context.lineTo(x * cell, height * cell);
    context.stroke();
  }

  for (let y = 0; y <= height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * cell);
    context.lineTo(width * cell, y * cell);
    context.stroke();
  }
}

function drawFruit(fruit, cell, progress) {
  const x = (fruit.x + 0.5) * cell;
  const y = (fruit.y + 0.5) * cell;
  const pulse = 1 + Math.sin((performance.now() / 180) + fruit.x + fruit.y + progress) * 0.08;

  context.save();
  context.translate(x, y);
  context.scale(pulse, pulse);

  context.fillStyle = "#f39c4f";
  context.beginPath();
  context.arc(0, 0, cell * 0.24, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#ffe6c3";
  context.lineWidth = Math.max(1.5, cell * 0.08);
  context.beginPath();
  context.moveTo(0, -cell * 0.16);
  context.quadraticCurveTo(cell * 0.1, -cell * 0.34, cell * 0.2, -cell * 0.18);
  context.stroke();

  context.restore();
}

function drawSnake(player, previousPlayer, cell, progress) {
  const currentBody = player.snake.body;
  const previousBody = previousPlayer?.snake?.body || currentBody;
  const interpolatedPoints = currentBody.map((segment, index) => {
    const from = previousBody[index] || previousBody[previousBody.length - 1] || segment;
    return {
      x: lerp(from.x + 0.5, segment.x + 0.5, progress) * cell,
      y: lerp(from.y + 0.5, segment.y + 0.5, progress) * cell
    };
  });

  if (interpolatedPoints.length < 2) {
    return;
  }

  const renderPoints = buildRenderPoints(interpolatedPoints);
  const lineWidth = Math.max(8, cell * 0.72);
  const glowWidth = lineWidth + cell * 0.34;

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  context.strokeStyle = hexToRgba(player.color, 0.18);
  context.lineWidth = glowWidth;
  context.beginPath();
  traceLine(renderPoints);
  context.stroke();

  context.strokeStyle = player.color;
  context.lineWidth = lineWidth;
  context.beginPath();
  traceLine(renderPoints);
  context.stroke();

  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = Math.max(2, lineWidth * 0.18);
  context.beginPath();
  traceHighlight(renderPoints, lineWidth * 0.12);
  context.stroke();

  const head = renderPoints[0];
  context.fillStyle = player.color;
  context.beginPath();
  context.arc(head.x, head.y, lineWidth * 0.46, 0, Math.PI * 2);
  context.fill();

  context.font = `${Math.max(12, cell * 0.72)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(player.emoji || "😎", head.x, head.y + cell * 0.03);
  context.restore();
}

function buildRenderPoints(points) {
  if (points.length < 3) {
    return points;
  }

  const samples = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const stepCount = 8;

    for (let step = 0; step < stepCount; step += 1) {
      const t = step / stepCount;
      samples.push(catmullRomPoint(p0, p1, p2, p3, t));
    }
  }

  samples.push(points[points.length - 1]);
  return samples;
}

function catmullRomPoint(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      0.5 *
      ((2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      ((2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
  };
}

function traceLine(points) {
  context.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
}

function traceHighlight(points, lift) {
  context.moveTo(points[0].x - lift, points[0].y - lift);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x - lift, points[index].y - lift);
  }
}

function renderPlayers() {
  const players = currentGameState.players;
  if (players.length === 0) {
    playerList.textContent = "No players have joined yet.";
    return;
  }

  playerList.innerHTML = players
    .map((player) => {
      const state = player.state === "respawning" ? "Respawning" : "";
      return `
        <div class="player-row">
          <span class="player-avatar" style="background:${player.color}" aria-hidden="true">${player.emoji || "😎"}</span>
          <span class="player-name">${escapeHtml(player.name)}</span>
          <span class="player-fruit">Fruit ${player.fruitCount ?? 0}</span>
          ${state ? `<strong class="player-state">${state}</strong>` : ""}
        </div>
      `;
    })
    .join("");
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
