const socket = io();
const modeSwitcher = document.getElementById("modeSwitcher");
const leaderboardBody = document.getElementById("leaderboardBody");
const leaderboardSummary = document.getElementById("leaderboardSummary");

let state = null;

socket.on("leaderboard-state", (nextState) => {
  state = nextState;
  render();
});

function render() {
  if (!state) {
    return;
  }

  leaderboardSummary.textContent = `${state.playerCount} players connected, ${state.aliveCount} alive. Ranking by ${state.scoringModeLabel}.`;

  modeSwitcher.innerHTML = Object.entries(state.scoringModes)
    .map(([mode, label]) => `
      <button class="mode-button ${state.scoringMode === mode ? "active" : ""}" data-mode="${mode}" type="button">
        ${label}
      </button>
    `)
    .join("");

  for (const button of modeSwitcher.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      socket.emit("set-scoring-mode", { mode: button.dataset.mode });
    });
  }

  leaderboardBody.innerHTML = state.rows
    .map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>
          <span class="player-chip">
            <span class="swatch" style="background:${row.color}"></span>
            <strong>${escapeHtml(row.name)}</strong>
            ${row.isBot ? '<span class="status-pill">AI</span>' : ""}
          </span>
        </td>
        <td>${renderStatus(row)}</td>
        <td>${row.currentLength}</td>
        <td>${row.fruitCount}</td>
        <td>${row.cumulativeScore}</td>
        <td>${row.deaths}</td>
      </tr>
    `)
    .join("");
}

function renderStatus(row) {
  if (row.state === "alive") {
    return `<span class="status-pill">Alive</span>`;
  }

  if (row.state === "respawning") {
    return `<span class="status-pill dead">Respawn in ${Math.ceil(row.respawnRemainingMs / 1000)}s</span>`;
  }

  return `<span class="status-pill">${escapeHtml(row.state)}</span>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
