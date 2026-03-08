# CLAUDE.MD

## Purpose
Working guide for AI/code agents in this repository (`short-deck-poker`).
Use this file as the first-stop context before making changes.

## Project Summary
- Full-stack real-time Short Deck Poker app.
- Frontend: Next.js 14 + React + TypeScript + Tailwind + Zustand + Socket.IO client.
- Backend: Express + Socket.IO + TypeScript.
- Data: Supabase Postgres (schema in `supabase/schema.sql`).
- Language in UI is mixed Chinese + English.

## Repo Layout
- `client/`: Next.js app (App Router).
- `server/`: Express + Socket.IO game server.
- `supabase/schema.sql`: full DB schema, policies, views.
- `README.md`: setup and deployment notes.

Do not edit generated/vendor directories unless explicitly asked:
- `client/node_modules`, `server/node_modules`
- `client/.next`
- lockfiles (`client/package-lock.json`, `server/package-lock.json`) unless dependency work is requested.

## Local Run Commands
- Backend dev: `cd server && npm run dev` (port `4000` by default)
- Frontend dev: `cd client && npm run dev` (port `3000` by default)
- Backend build: `cd server && npm run build`
- Frontend build: `cd client && npm run build`
- Backend lint: `cd server && npm run lint`
- Frontend lint: `cd client && npm run lint`

## Environment
Expected env files (not committed):
- `server/.env`
  - `PORT`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CLIENT_URL`
- `client/.env.local`
  - `NEXT_PUBLIC_SOCKET_URL`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never print or commit secrets from local `.env` files.

## Architecture Notes

### Frontend
- Entry points:
  - `client/src/app/page.tsx` -> `client/src/app/_lobby.tsx`
  - `client/src/app/room/[id]/page.tsx`
- State store: `client/src/store/gameStore.ts` (connection, room, game, chat, timer, hand-result modal).
- Socket hook: `client/src/hooks/useSocket.ts`
  - owns singleton socket
  - registers listeners
  - starts local 30s action countdown
  - exposes room/game/chat actions
- Main game UI: `client/src/components/GameTable.tsx` with `PlayerSeat`, `Card`, `ActionPanel`, `ChatPanel`.

### Backend
- Server entry: `server/src/index.ts`
  - REST routes mounted at `/api/rooms`
  - Socket.IO setup and handler registration
- Socket orchestration: `server/src/socket/gameHandler.ts`
  - room create/join/leave
  - start game / actions / next hand
  - bot scheduling + human timeout auto-fold
  - broadcasts sanitized state per player
  - persists game/chat/history through Supabase layer
- Poker engine: `server/src/game/engine.ts`
  - `initHand`, `applyAction`, stage progression, showdown resolution
  - `sanitizeStateFor` hides other players' hole cards until showdown
- Hand evaluator: `server/src/game/handEvaluator.ts`
  - short-deck ranking differences are implemented here
- Bot logic: `server/src/game/botAI.ts`

### Database
- Supabase access layer: `server/src/db/supabase.ts`
- Schema: `supabase/schema.sql`
  - tables: `rooms`, `players`, `game_states`, `hand_history`, `chat_messages`
  - RLS enabled with permissive policies in this setup
  - views: `room_leaderboard`, `recent_rooms`

## Critical Domain Rules (Short Deck)
- 36-card deck: ranks `6` to `A`.
- Flush beats Full House.
- Three of a Kind beats Straight.
- `A-6-7-8-9` is the lowest straight.

If changing game logic, keep these rules intact unless explicitly asked otherwise.

## Type Sync Contract
`client/src/types/poker.ts` mirrors `server/src/types/poker.ts`.
When adding/changing shared event/state types, update both files together.

## Change Guidelines
- Keep edits minimal and scoped.
- Preserve current visual style (gold/felt poker theme) unless redesign is requested.
- Favor TypeScript-safe changes; avoid `any` unless unavoidable.
- Do not silently change action timeout semantics (currently 30s in client and server paths).
- For socket changes, verify both emitters and listeners.
- For game-state changes, verify sanitize + persistence + UI rendering paths.

## Validation Checklist
After meaningful changes:
1. Run server/frontend lint or build for touched side.
2. Smoke-check key flow: create room -> join -> start -> act -> showdown -> next hand.
3. Confirm no secret/env files were modified.
4. Confirm no generated directories were edited unintentionally.

## Known Gaps / Gotchas
- No automated test suite is currently present.
- `README.md` references some files that are no longer present (`client/src/lib/supabase.ts`), so rely on actual tree.
- Human action timeout is hardcoded to 30s in server socket handler.
- There is a literal directory named `{server,client}` at repo root; treat as unrelated unless asked.
