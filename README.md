# Competitive QR Snake

`Competitive QR Snake` is a local-first multiplayer snake game built for shared-screen events. One machine runs the game server and renders the arena, while players join from their phones and use a simple controller page to steer their snake in real time.

The project is designed for party play, classrooms, showcases, and installations where you want:

- a single shared arena display
- fast QR-based join flow
- lightweight phone controls
- a separate leaderboard screen
- server-authoritative game rules

## How It Works

The app has three main surfaces:

- Controller: players open the root route on a phone, choose a name and color, and control their snake with four-direction buttons
- Arena: the shared game display renders the full playfield, fruit, snakes, and join QR code
- Leaderboard: a separate screen shows rankings and lets viewers switch between scoring modes

The Node.js server owns all game state and broadcasts updates over `Socket.IO`, so movement, collisions, respawns, and scoring stay consistent for every connected client.

## Current Features

- Authoritative multiplayer game server with `Express` and `Socket.IO`
- Shared-screen arena with animated canvas rendering
- Mobile-friendly controller with reconnect support via `localStorage`
- Name and color selection for up to 9 players
- Optional AI bot fill to maintain a minimum of 4 total players
- Separate leaderboard view with live ranking updates
- Three scoring modes:
  - `Longest Now`
  - `Most Fruit`
  - `Cumulative Score`
- Death handling with respawn countdowns and safe respawn attempts
- Keyboard support on the controller page with arrow keys and `WASD`

## Project Structure

```text
src/
  server.js        Express + Socket.IO server
  game.js          Core game rules, state, bots, scoring, respawn logic

public/
  controller.html  Phone controller UI
  arena.html       Shared arena screen
  leaderboard.html Separate leaderboard screen
  styles.css       Shared styling
  scripts/
    controller.js  Controller client logic
    arena.js       Arena renderer
    leaderboard.js Leaderboard client logic
```

## Requirements

- Node.js `22` or newer
- A browser for the arena / leaderboard displays
- Phones or other browsers on the same network for players

## Run Locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

For development with Node's watch mode:

```bash
npm run dev
```

By default the server listens on:

```text
http://<your-lan-ip>:3100
```

Open these routes:

- `http://<your-lan-ip>:3100/` for the phone controller
- `http://<your-lan-ip>:3100/arena` for the shared arena display
- `http://<your-lan-ip>:3100/leaderboard` for the separate leaderboard

## Configuration

Environment variables currently supported by the server:

- `PORT`
  Overrides the default port. Defaults to `3100`.
- `HOST`
  Overrides the bind host. Defaults to `0.0.0.0`.
- `JOIN_URL`
  Forces the public join URL shown in the QR code and arena UI.
- `ENABLE_AI_PLAYERS`
  Set to `true` to automatically add bots until there are at least 4 total players.

When `JOIN_URL` is not set:

- local runs use `http://<your-lan-ip>:3100`
- Fly.io runs use `https://browser-snake.fly.dev` or `https://<FLY_APP_NAME>.fly.dev`

Example:

```bash
PORT=3000 ENABLE_AI_PLAYERS=true npm start
```

## Gameplay Notes

- Grid size is `32 x 18`
- Tick rate is `180ms`
- Base snake length is `4`
- Respawn delay is `3000ms`
- Fruit target on the board is `6`
- Maximum players is `9`

Collision rules:

- Snakes die when they hit a wall
- Snakes die when they hit an occupied body cell
- Head-to-head collisions eliminate all snakes contesting the same next cell

Scoring rules:

- `Longest Now`: ranks by current snake length
- `Most Fruit`: ranks by fruit collected
- `Cumulative Score`: awards score over time based on alive snake length

## Typical Event Setup

1. Start the server on a machine connected to the local network.
2. Open `/arena` on the main display.
3. Open `/leaderboard` on a second display if you want standings separate from the arena.
4. Have players scan the QR code shown on the arena screen.
5. Players join, pick a color, and steer from their phones.

## Tech Stack

- Node.js
- Express
- Socket.IO
- QRCode
- Plain HTML, CSS, and browser-side JavaScript

## Status

This is currently a small self-contained event game project with no automated test suite yet. The codebase is easy to run locally and is structured so gameplay, rendering, and controller behavior are separated cleanly.
