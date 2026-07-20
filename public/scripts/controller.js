const AVATAR_CHOICES = [
  { color: "#ff6b6b", emoji: "😎", name: "Cool" },
  { color: "#f39c4f", emoji: "🦊", name: "Fox" },
  { color: "#ffe66d", emoji: "🐯", name: "Tiger" },
  { color: "#56d2c3", emoji: "🐸", name: "Frog" },
  { color: "#6fa8ff", emoji: "🐙", name: "Octopus" },
  { color: "#c77dff", emoji: "🦄", name: "Unicorn" },
  { color: "#ff8fab", emoji: "🐼", name: "Panda" },
  { color: "#7bd389", emoji: "🐢", name: "Turtle" },
  { color: "#72ddf7", emoji: "🤖", name: "Robot" }
];

const socket = io();
const joinForm = document.getElementById("joinForm");
const colorRow = document.getElementById("colorRow");
const controllerPanel = document.getElementById("controllerPanel");
const banner = document.getElementById("banner");
const deathBanner = document.getElementById("deathBanner");
const nameInput = document.getElementById("nameInput");
const joinButton = document.getElementById("joinButton");
const playerName = document.getElementById("playerName");
const playerStatus = document.getElementById("playerStatus");
const fruitCount = document.getElementById("fruitCount");
const cumulativeScore = document.getElementById("cumulativeScore");
const upTurn = document.getElementById("upTurn");
const downTurn = document.getElementById("downTurn");
const leftTurn = document.getElementById("leftTurn");
const rightTurn = document.getElementById("rightTurn");
const controllerAvatar = document.getElementById("controllerAvatar");

let selectedColor = null;
let player = null;
let joinConfig = null;
let takenColors = new Set();

renderColors();
updateJoinAvailability();

socket.on("connect", () => {
  const savedPlayerId = localStorage.getItem("snakePlayerId");
  if (savedPlayerId) {
    socket.emit("reconnect-intent", { playerId: savedPlayerId });
  }

  setBanner("Connected. Ready when you are.");
});

socket.on("disconnect", () => {
  setBanner("Connection lost. Reconnecting...", true);
});

socket.on("session-config", (config) => {
  joinConfig = config;
});

socket.on("join-accepted", (payload) => {
  player = payload.player;
  joinConfig = payload.config;
  localStorage.setItem("snakePlayerId", player.playerId);
  localStorage.setItem("snakePlayerName", player.name);
  showController();
  updatePlayerSummary(player);
  setBanner("You are in. Tap a direction to steer.");
});

socket.on("join-rejected", (payload) => {
  setBanner(payload.reason, true);
});

socket.on("player-died", ({ respawnAt }) => {
  const seconds = Math.max(1, Math.ceil((respawnAt - Date.now()) / 1000));
  deathBanner.textContent = `You crashed. Back in ${seconds}s.`;
  deathBanner.classList.remove("hidden");
  if (navigator.vibrate) {
    navigator.vibrate([120, 80, 180]);
  }
});

socket.on("game-state", (state) => {
  takenColors = new Set(state.players.map((entry) => entry.color));

  if (!player && selectedColor && takenColors.has(selectedColor)) {
    selectedColor = null;
  }

  if (!player) {
    renderColors();
    updateJoinAvailability();
  }

  if (!player) {
    return;
  }

  const fresh = state.players.find((entry) => entry.playerId === player.playerId);
  if (!fresh) {
    localStorage.removeItem("snakePlayerId");
    player = null;
    controllerPanel.classList.add("hidden");
    joinForm.classList.remove("hidden");
    document.body.classList.remove("controller-panel-mobile-clean", "controller-active");
    document.body.style.removeProperty("--controller-color");
    setBanner("Your session ended. Join again to re-enter.");
    return;
  }

  player.state = fresh.state;
  player.fruitCount = fresh.fruitCount;
  player.cumulativeScore = fresh.cumulativeScore;
  updatePlayerSummary(player);

  if (fresh.state === "alive") {
    deathBanner.classList.add("hidden");
  } else if (fresh.state === "respawning") {
    const seconds = Math.ceil(fresh.respawnRemainingMs / 1000);
    deathBanner.textContent = `Respawning in ${seconds}s.`;
    deathBanner.classList.remove("hidden");
  }
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name || !selectedColor) {
    updateJoinAvailability();
    if (!name) {
      nameInput.focus();
    }
    return;
  }

  localStorage.setItem("snakePlayerName", name);
  socket.emit("join", {
    playerId: localStorage.getItem("snakePlayerId"),
    name,
    color: selectedColor
  });
});

nameInput.addEventListener("input", updateJoinAvailability);

bindDirection(upTurn, "up");
bindDirection(downTurn, "down");
bindDirection(leftTurn, "left");
bindDirection(rightTurn, "right");

// Keep the connected phone view feeling like a dedicated controller in browsers
// that still expose pinch-to-zoom or double-tap zoom gestures.
document.addEventListener("gesturestart", (event) => event.preventDefault(), { passive: false });
document.addEventListener("dblclick", (event) => {
  if (player) {
    event.preventDefault();
  }
}, { passive: false });

window.addEventListener("keydown", (event) => {
  const direction = KEY_TO_DIRECTION[event.key];
  if (!direction || !player) {
    return;
  }

  event.preventDefault();
  socket.emit("set-direction", { direction });
});

function bindDirection(button, direction) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    socket.emit("set-direction", { direction });
  });
}

function renderColors() {
  colorRow.innerHTML = AVATAR_CHOICES.map(({ color, emoji, name }) => `
    <button
      type="button"
      class="color-choice ${color === selectedColor ? "active" : ""} ${takenColors.has(color) ? "taken" : ""}"
      data-color="${color}"
      style="background:${color}"
      aria-label="Choose ${name} avatar"
      aria-pressed="${color === selectedColor}"
      ${takenColors.has(color) ? "disabled" : ""}
    >${emoji}</button>
  `).join("");

  for (const button of colorRow.querySelectorAll("button")) {
    if (button.disabled) {
      continue;
    }

    button.addEventListener("click", () => {
      selectedColor = button.dataset.color;
      renderColors();
      updateJoinAvailability();
    });
  }
}

function updateJoinAvailability() {
  const hasName = Boolean(nameInput.value.trim());
  const hasAvatar = Boolean(selectedColor);
  nameInput.classList.toggle("name-required", !hasName);
  nameInput.setAttribute("aria-invalid", String(!hasName));
  joinButton.disabled = !hasName || !hasAvatar;
}

function showController() {
  document.body.classList.add("controller-panel-mobile-clean", "controller-active");
  document.body.style.setProperty("--controller-color", player.color);
  controllerAvatar.textContent = player.emoji || "😎";
  joinForm.classList.add("hidden");
  controllerPanel.classList.remove("hidden");
}

function updatePlayerSummary(currentPlayer) {
  playerName.textContent = currentPlayer.name;
  playerStatus.textContent =
    currentPlayer.state === "respawning" ? "Respawning" : capitalize(currentPlayer.state || "alive");
  fruitCount.textContent = currentPlayer.fruitCount ?? 0;
  cumulativeScore.textContent = currentPlayer.cumulativeScore ?? 0;
}

function setBanner(message, isError = false) {
  banner.textContent = message;
  banner.classList.remove("hidden", "error");
  if (isError) {
    banner.classList.add("error");
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const KEY_TO_DIRECTION = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
  W: "up",
  A: "left",
  S: "down",
  D: "right"
};
