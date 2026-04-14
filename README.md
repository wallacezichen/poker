# Poker (Realtime Multiplayer)

A full-stack realtime multiplayer poker app with multiple game modes, host controls, run-it-twice flow, bomb pot, and custom side bonus logic.

## Game Modes

- 德州扑克 (`regular`)
- 短牌 (`short_deck`)
- 奥马哈 (`omaha`)
- 疯狂大菠萝 (`crazy_pineapple`)

## Implemented Features

- Realtime room + table via Socket.IO
- Host approval flow for joining private room
- Reconnect/resume by `roomId + playerId`
- Away mode and pause/resume by host
- Bot player support
- Side-pot/all-in handling across all game modes
- Run It Twice (with agreement voting and two-run results)
- Showdown display with best-hand card emphasis
- Rebuy prompt when stack reaches 0
- Rebuy badge (`🔁`, with count when `>= 2`)
- Session Ledger modal and settlement screen
- Keyboard shortcuts for core actions (`C/R/K/F`, `Y/N` for Run It Twice)
- Host options panel:
  - Blinds update (`SB/BB`)
  - Bomb Pot settings
  - 27 Game settings

## Special Mechanics

### Bomb Pot

- Host can enable bomb pot and configure:
  - ante amount per player
  - interval (every N hands)
- On bomb hands, players auto-post in sequence (with chip sound/animation), then hand proceeds.

### 27 Game

- Host can enable and configure amount per other player.
- Bonus triggers if:
  - exactly one winner, and
  - that winner’s hole cards include both `2` and `7`, and
  - it is not a split pot.
- Hand can end either by folds or showdown.
- Other players auto-pay the configured amount (capped by their remaining chips), then total is awarded to that winner.

## Rules Notes by Mode

- 德州扑克: standard 52-card Texas Hold'em ranking.
- 短牌: flush > full house, and `A-6-7-8-9` is the wheel straight.
- 奥马哈: exactly 2 hole cards + 3 board cards must be used.
- 疯狂大菠萝: players start with 3 hole cards and discard 1 after flop.

## Tech Stack

- Frontend: Next.js 14 + TypeScript + Tailwind + Zustand + Socket.IO Client
- Backend: Node.js + Express + Socket.IO + TypeScript
- Database: Supabase (PostgreSQL)

## Project Structure

```txt
client/    Next.js frontend
server/    Express + Socket.IO game server
supabase/  SQL schema
```

## Local Development

### 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Environment variables

Create `server/.env`:

```env
PORT=4000
HOST=0.0.0.0
CLIENT_URL=http://localhost:3000
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Create `client/.env.local`:

```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_API_URL=http://localhost:4000
```

### 3. Run

```bash
# terminal 1
cd server
npm run dev

# terminal 2
cd client
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
cd server && npm run build
cd ../client && npm run build
```

## Database Setup

Run:

- [`supabase/schema.sql`](supabase/schema.sql)

in Supabase SQL Editor to create required tables, policies, and views.
