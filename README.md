# 🃏 Short Deck Poker (短牌德州扑克)

A full-stack real-time multiplayer Short Deck Texas Hold'em poker game 
Create your first game room: https://poker-omega-blue.vercel.app/

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

