# 🃏 Short Deck Poker (短牌德州扑克)

A full-stack real-time multiplayer Short Deck Texas Hold'em poker game — similar to PokerNow but for Short Deck rules.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router, TypeScript) |
| Backend | Node.js + Express + Socket.IO |
| Database | Supabase (PostgreSQL, free tier) |
| Real-time | WebSockets via Socket.IO |

## Short Deck Rules

- **36-card deck** — 2s, 3s, 4s, 5s removed
- **Flush beats Full House** (unlike standard poker)
- **Three of a Kind beats Straight** (unlike standard poker)  
- **A-6-7-8-9 is the lowest straight** (A acts as low card)
- Hand rankings (high → low): Royal Flush > Straight Flush > Four of a Kind > **Flush** > **Full House** > **Straight** > **Three of a Kind** > Two Pair > One Pair > High Card

## Features

- 🏠 Create a room and share a link
- 👥 Up to 9 players per room
- 🤖 Add AI bots to fill seats
- 💬 In-game chat
- 📊 Game history tracked in database
- ⏱️ Action timer (30 seconds)
- 📱 Responsive design

---

## Setup

### 1. Supabase (Database) — Free

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
4. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Fill in your Supabase credentials in .env
npm run dev
```

### 3. Frontend Setup

```bash
cd client
npm install
cp .env.example .env.local
# Fill in your backend URL and Supabase credentials
npm run dev
```

### 4. Open the App

- Frontend: http://localhost:3000
- Backend: http://localhost:4000

---

## Project Structure

```
short-deck-poker/
├── README.md
├── supabase/
│   └── schema.sql          # Database schema
├── server/                 # Node.js + Express + Socket.IO
│   ├── package.json
│   ├── .env.example
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── socket/
│   │   │   └── gameHandler.ts   # Socket.IO event handlers
│   │   ├── game/
│   │   │   ├── engine.ts        # Poker game logic
│   │   │   ├── handEvaluator.ts # Short deck hand evaluator
│   │   │   └── botAI.ts         # Bot player AI
│   │   ├── db/
│   │   │   └── supabase.ts      # Supabase client + queries
│   │   └── routes/
│   │       └── rooms.ts         # REST API routes
└── client/                 # Next.js 14
    ├── package.json
    ├── .env.example
    └── src/
        ├── app/
        │   ├── page.tsx          # Lobby / home page
        │   ├── room/[id]/
        │   │   └── page.tsx      # Game room page
        │   └── layout.tsx
        ├── components/
        │   ├── Lobby.tsx
        │   ├── WaitingRoom.tsx
        │   ├── GameTable.tsx
        │   ├── Card.tsx
        │   ├── PlayerSeat.tsx
        │   ├── ActionPanel.tsx
        │   └── ChatPanel.tsx
        ├── hooks/
        │   └── useSocket.ts      # Socket.IO hook
        ├── lib/
        │   └── supabase.ts       # Supabase client
        └── types/
            └── poker.ts          # Shared TypeScript types
```

## Environment Variables

### server/.env
```
PORT=4000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CLIENT_URL=http://localhost:3000
```

### client/.env.local
```
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## Deployment

### Free Deployment Options

| Service | Free Tier |
|---------|-----------|
| **Vercel** | Frontend (Next.js) — unlimited |
| **Railway** | Backend (Node.js) — $5 credit/month free |
| **Render** | Backend — 750 hrs/month free |
| **Supabase** | Database — 500MB, unlimited API calls |

### Deploy to Vercel + Railway

```bash
# Frontend to Vercel
cd client
npx vercel --prod

# Backend to Railway
cd server
railway up
```
