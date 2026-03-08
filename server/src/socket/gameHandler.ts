import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ClientToServerEvents, ServerToClientEvents, RoomSettings, RoomPlayer } from '../types/poker';
import { initHand, applyAction, sanitizeStateFor, FullGameState, advanceRunoutStreet } from '../game/engine';
import { decideBotAction, getBotThinkTime } from '../game/botAI';
import {
  createRoom, getRoom, updateRoomStatus, upsertPlayer,
  updatePlayerChips, updatePlayerConnection, getPlayers, removePlayer,
  saveGameState, loadGameState, saveHandHistory,
  saveChat, getChatHistory,
} from '../db/supabase';

// In-memory game states for fast access (persisted to DB async)
const activeGames = new Map<string, FullGameState>();
// Map socket.id → { roomId, playerId }
const socketToPlayer = new Map<string, { roomId: string; playerId: string }>();
// Map roomId → { playerId → socketId }
const roomSockets = new Map<string, Map<string, string>>();
// Action timers
const actionTimers = new Map<string, NodeJS.Timeout>();
// Delayed board runout timers (all-in suspense reveal)
const runoutTimers = new Map<string, NodeJS.Timeout>();
// Map roomId -> players marked away (observer only, skipped in next hands)
const awayPlayersByRoom = new Map<string, Set<string>>();
// Room pause state
const pausedRooms = new Set<string>();
type PendingJoinRequest = { requestId: string; roomId: string; playerName: string; socketId: string; requestedAt: string };
const pendingJoinRequestsByRoom = new Map<string, Map<string, PendingJoinRequest>>();
const pendingRebuyPromptsByRoom = new Map<string, Set<string>>();

const PLAYER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63', '#00bcd4',
];

const BOT_NAMES = [
  '阿豪', '小明', '老王', '大牛', '小李', '阿强', '胖哥', '阿飞',
];

function randomId(len = 8) {
  return Math.random().toString(36).substr(2, len).toUpperCase();
}

function roomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function isPlayerAway(roomId: string, playerId: string): boolean {
  return awayPlayersByRoom.get(roomId)?.has(playerId) ?? false;
}

function setPlayerAway(roomId: string, playerId: string, away: boolean): void {
  if (!awayPlayersByRoom.has(roomId)) awayPlayersByRoom.set(roomId, new Set());
  const set = awayPlayersByRoom.get(roomId)!;
  if (away) set.add(playerId);
  else set.delete(playerId);
  if (set.size === 0) awayPlayersByRoom.delete(roomId);
}

function addPendingJoinRequest(req: PendingJoinRequest): void {
  if (!pendingJoinRequestsByRoom.has(req.roomId)) pendingJoinRequestsByRoom.set(req.roomId, new Map());
  pendingJoinRequestsByRoom.get(req.roomId)!.set(req.requestId, req);
}

function removePendingJoinRequest(roomId: string, requestId: string): void {
  const map = pendingJoinRequestsByRoom.get(roomId);
  if (!map) return;
  map.delete(requestId);
  if (map.size === 0) pendingJoinRequestsByRoom.delete(roomId);
}

function removePendingRequestsBySocket(socketId: string): void {
  for (const [roomId, map] of pendingJoinRequestsByRoom.entries()) {
    for (const [reqId, req] of map.entries()) {
      if (req.socketId === socketId) map.delete(reqId);
    }
    if (map.size === 0) pendingJoinRequestsByRoom.delete(roomId);
  }
}

function setPendingRebuyPrompt(roomId: string, playerId: string, pending: boolean): void {
  if (!pendingRebuyPromptsByRoom.has(roomId)) pendingRebuyPromptsByRoom.set(roomId, new Set());
  const set = pendingRebuyPromptsByRoom.get(roomId)!;
  if (pending) set.add(playerId);
  else set.delete(playerId);
  if (set.size === 0) pendingRebuyPromptsByRoom.delete(roomId);
}

function hasPendingRebuyPrompt(roomId: string, playerId: string): boolean {
  return pendingRebuyPromptsByRoom.get(roomId)?.has(playerId) ?? false;
}

export function registerGameHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
) {
  // ============================================================
  // CREATE ROOM
  // ============================================================
  socket.on('room:create', async ({ playerName, settings }, cb) => {
    try {
      const roomId = roomCode();
      const playerId = randomId();
      const roomSettings: RoomSettings = {
        startingChips: settings.startingChips ?? 5000,
        smallBlind: settings.smallBlind ?? 50,
        bigBlind: settings.bigBlind ?? 100,
        maxPlayers: settings.maxPlayers ?? 9,
        actionTimeout: settings.actionTimeout ?? 30,
      };

      await createRoom(roomId, playerId, roomSettings);

      const player: RoomPlayer = {
        id: playerId,
        name: playerName,
        color: PLAYER_COLORS[0],
        chips: roomSettings.startingChips,
        seatIndex: 0,
        isBot: false,
        isConnected: true,
      };

      await upsertPlayer(roomId, player);

      // Track socket
      socket.join(roomId);
      socketToPlayer.set(socket.id, { roomId, playerId });
      if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Map());
      roomSockets.get(roomId)!.set(playerId, socket.id);
      setPlayerAway(roomId, playerId, false);

      const room = await getFullRoom(roomId);
      if (!room) return cb({ success: false, error: 'Failed to load room' });
      cb({ success: true, room, playerId });
    } catch (err: any) {
      console.error('room:create error', err);
      cb({ success: false, error: err.message });
    }
  });

  // ============================================================
  // JOIN ROOM
  // ============================================================
  socket.on('room:join', async ({ roomId, playerName }, cb) => {
    try {
      const roomData = await getRoom(roomId.toUpperCase());
      if (!roomData) return cb({ success: false, error: '房间不存在' });

      const existingPlayers = await getPlayers(roomId.toUpperCase());
      if (existingPlayers.length >= roomData.settings.maxPlayers) {
        return cb({ success: false, error: '房间已满' });
      }

      // Game already started: create join request for host approval
      if (roomData.status !== 'waiting') {
        const roomIdUp = roomId.toUpperCase();
        const requestId = 'REQ_' + randomId(6);
        const req: PendingJoinRequest = {
          requestId,
          roomId: roomIdUp,
          playerName,
          socketId: socket.id,
          requestedAt: new Date().toISOString(),
        };
        addPendingJoinRequest(req);

        const hostSocketId = roomSockets.get(roomIdUp)?.get(roomData.host_id);
        if (hostSocketId) {
          io.to(hostSocketId).emit('room:join_request', {
            requestId: req.requestId,
            roomId: req.roomId,
            playerName: req.playerName,
            requestedAt: req.requestedAt,
          });
        }

        return cb({ success: true, pendingApproval: true, requestId });
      }

      const playerId = randomId();
      const seatIdx = existingPlayers.length;
      const player: RoomPlayer = {
        id: playerId,
        name: playerName,
        color: PLAYER_COLORS[seatIdx % PLAYER_COLORS.length],
        chips: roomData.settings.startingChips,
        seatIndex: seatIdx,
        isBot: false,
        isConnected: true,
      };

      await upsertPlayer(roomId.toUpperCase(), player);

      socket.join(roomId.toUpperCase());
      socketToPlayer.set(socket.id, { roomId: roomId.toUpperCase(), playerId });
      if (!roomSockets.has(roomId.toUpperCase())) roomSockets.set(roomId.toUpperCase(), new Map());
      roomSockets.get(roomId.toUpperCase())!.set(playerId, socket.id);
      setPlayerAway(roomId.toUpperCase(), playerId, false);
      io.to(socket.id).emit('game:paused', pausedRooms.has(roomId.toUpperCase()));

      const room = await getFullRoom(roomId.toUpperCase());

      // Load existing game state if any
      let gameState = activeGames.get(roomId.toUpperCase());
      if (!gameState) {
        gameState = await loadGameState(roomId.toUpperCase()) ?? undefined;
        if (gameState) activeGames.set(roomId.toUpperCase(), gameState);
      }

      // Notify others
      if (room) {
        io.to(roomId.toUpperCase()).except(socket.id).emit('room:updated', room);
      }

      // Restore chat
      await getChatHistory(roomId.toUpperCase());

      cb({
        success: true,
        room: room ?? undefined,
        playerId,
        gameState: gameState ? sanitizeStateFor(gameState, playerId) : undefined,
      });
    } catch (err: any) {
      console.error('room:join error', err);
      cb({ success: false, error: err.message });
    }
  });

  // ============================================================
  // RESUME ROOM (same browser/session)
  // ============================================================
  socket.on('room:resume', async ({ roomId, playerId }, cb) => {
    try {
      const roomIdUp = roomId.toUpperCase();
      const roomData = await getRoom(roomIdUp);
      if (!roomData) return cb({ success: false, error: '房间不存在' });

      const players = await getPlayers(roomIdUp);
      const player = players.find(p => p.id === playerId && !p.isBot);
      if (!player) return cb({ success: false, error: '玩家会话已失效' });

      // If this player already has another live socket, replace it.
      const existingSocketId = roomSockets.get(roomIdUp)?.get(playerId);
      if (existingSocketId && existingSocketId !== socket.id) {
        socketToPlayer.delete(existingSocketId);
        const oldSocket = io.sockets.sockets.get(existingSocketId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      socket.join(roomIdUp);
      socketToPlayer.set(socket.id, { roomId: roomIdUp, playerId });
      if (!roomSockets.has(roomIdUp)) roomSockets.set(roomIdUp, new Map());
      roomSockets.get(roomIdUp)!.set(playerId, socket.id);

      await updatePlayerConnection(roomIdUp, playerId, true);

      const room = await getFullRoom(roomIdUp);
      let gameState = activeGames.get(roomIdUp);
      if (!gameState) {
        gameState = await loadGameState(roomIdUp) ?? undefined;
        if (gameState) activeGames.set(roomIdUp, gameState);
      }

      if (room) io.to(roomIdUp).emit('room:updated', room);
      io.to(socket.id).emit('game:paused', pausedRooms.has(roomIdUp));
      io.to(roomIdUp).emit('player:connected', playerId);

      cb({
        success: true,
        room: room ?? undefined,
        playerId,
        gameState: gameState ? sanitizeStateFor(gameState, playerId) : undefined,
      });
    } catch (err: any) {
      console.error('room:resume error', err);
      cb({ success: false, error: err.message });
    }
  });

  // ============================================================
  // ADD BOT
  // ============================================================
  socket.on('room:add_bot', async (cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false });

    const { roomId } = session;
    const players = await getPlayers(roomId);
    if (players.length >= 9) return cb({ success: false });

    const botId = 'BOT_' + randomId(6);
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] +
      Math.floor(Math.random() * 99 + 1);
    const roomData = await getRoom(roomId);
    const seatIdx = players.length;

    const bot: RoomPlayer = {
      id: botId,
      name: botName,
      color: PLAYER_COLORS[seatIdx % PLAYER_COLORS.length],
      chips: roomData?.settings?.startingChips ?? 5000,
      seatIndex: seatIdx,
      isBot: true,
      isConnected: true,
    };

    await upsertPlayer(roomId, bot);
    const room = await getFullRoom(roomId);
    io.to(roomId).emit('room:updated', room!);
    cb({ success: true });
  });

  // ============================================================
  // HOST MANAGE PLAYER (set chips / kick)
  // ============================================================
  socket.on('room:host_manage_player', async ({ targetPlayerId, action, chips }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });
    const { roomId, playerId } = session;

    const roomData = await getRoom(roomId);
    if (!roomData) return cb({ success: false, error: 'Room not found' });
    if (roomData.host_id !== playerId) return cb({ success: false, error: 'Only host can manage players' });
    if (targetPlayerId === playerId) return cb({ success: false, error: 'Cannot manage host seat' });

    const players = await getPlayers(roomId);
    const target = players.find(p => p.id === targetPlayerId);
    if (!target) return cb({ success: false, error: 'Player not found' });

    if (action === 'set_chips') {
      const nextChips = Math.max(0, Math.floor(chips ?? target.chips));
      console.log(`[Socket][host_manage] set_chips room=${roomId} target=${targetPlayerId} chips=${nextChips}`);
      await updatePlayerChips(roomId, targetPlayerId, nextChips);

      const state = activeGames.get(roomId);
      if (state) {
        const inHand = state.players.find(p => p.id === targetPlayerId);
        if (inHand) {
          inHand.chips = nextChips;
          inHand.allIn = nextChips === 0;
          if (nextChips === 0) {
            inHand.folded = true;
            state.playersToAct = state.playersToAct.filter(id => id !== targetPlayerId);
          }
          await saveGameState(state);
          broadcastGameState(io, roomId, state);
        }
      }

      const room = await getFullRoom(roomId);
      if (room) io.to(roomId).emit('room:updated', room);
      return cb({ success: true });
    }

    // action === 'kick'
    const targetSocketId = roomSockets.get(roomId)?.get(targetPlayerId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('room:player_kicked', { roomId, reason: 'Removed by host' });
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) targetSocket.leave(roomId);
      socketToPlayer.delete(targetSocketId);
    }

    roomSockets.get(roomId)?.delete(targetPlayerId);
    setPlayerAway(roomId, targetPlayerId, true);

    const state = activeGames.get(roomId);
    if (state) {
      const p = state.players.find(x => x.id === targetPlayerId);
      if (p) {
        const wasCurrentActor =
          state.stage !== 'showdown' &&
          state.players[state.currentPlayerIndex]?.id === targetPlayerId &&
          !p.folded &&
          !p.allIn;

        if (wasCurrentActor) {
          clearActionTimer(roomId);
          const { state: newState } = applyAction(state, targetPlayerId, 'fold');
          activeGames.set(roomId, newState);
          saveGameState(newState).catch(console.error);
          broadcastGameState(io, roomId, newState);

          if (newState.stage === 'showdown') {
            finishShowdown(io, roomId, newState);
          } else if (maybeStartRunItTwiceOffer(io, roomId, newState)) {
            // wait for yes/no votes
          } else if (shouldAutoRunout(newState)) {
            startDelayedRunout(io, roomId);
          } else {
            scheduleCurrentPlayerAction(io, roomId, newState);
          }
        } else {
          p.folded = true;
          p.allIn = true;
          p.isConnected = false;
          state.actionLog.push({
            playerId: p.id,
            playerName: p.name,
            action: 'fold',
            timestamp: Date.now(),
          });
          state.playersToAct = state.playersToAct.filter(id => id !== targetPlayerId);
          saveGameState(state).catch(console.error);
          broadcastGameState(io, roomId, state);
        }
      }
    }

    await removePlayer(roomId, targetPlayerId);
    const room = await getFullRoom(roomId);
    if (room) io.to(roomId).emit('room:updated', room);
    cb({ success: true });
  });

  // ============================================================
  // JOIN REQUEST DECISION (host only)
  // ============================================================
  socket.on('room:join_request_decision', async ({ requestId, approve, buyIn }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });
    const { roomId, playerId } = session;

    const roomData = await getRoom(roomId);
    if (!roomData) return cb({ success: false, error: 'Room not found' });
    if (roomData.host_id !== playerId) return cb({ success: false, error: 'Only host can decide' });

    const reqMap = pendingJoinRequestsByRoom.get(roomId);
    const req = reqMap?.get(requestId);
    if (!req) return cb({ success: false, error: 'Request not found' });

    if (!approve) {
      io.to(req.socketId).emit('room:join_denied', { requestId, error: 'Host denied your request' });
      removePendingJoinRequest(roomId, requestId);
      return cb({ success: true });
    }

    const existingPlayers = await getPlayers(roomId);
    if (existingPlayers.length >= roomData.settings.maxPlayers) {
      io.to(req.socketId).emit('room:join_denied', { requestId, error: 'Room is full' });
      removePendingJoinRequest(roomId, requestId);
      return cb({ success: false, error: 'Room is full' });
    }

    const approvedBuyIn = Math.max(1, Math.floor(buyIn ?? roomData.settings.startingChips));
    const playerIdNew = randomId();
    const seatIdx = existingPlayers.length;

    const player: RoomPlayer = {
      id: playerIdNew,
      name: req.playerName,
      color: PLAYER_COLORS[seatIdx % PLAYER_COLORS.length],
      chips: approvedBuyIn,
      seatIndex: seatIdx,
      isBot: false,
      isConnected: true,
    };
    await upsertPlayer(roomId, player);

    const targetSocket = io.sockets.sockets.get(req.socketId);
    if (targetSocket) targetSocket.join(roomId);
    socketToPlayer.set(req.socketId, { roomId, playerId: playerIdNew });
    if (!roomSockets.has(roomId)) roomSockets.set(roomId, new Map());
    roomSockets.get(roomId)!.set(playerIdNew, req.socketId);
    setPlayerAway(roomId, playerIdNew, false);

    const room = await getFullRoom(roomId);
    let gameState = activeGames.get(roomId);
    if (!gameState) {
      gameState = await loadGameState(roomId) ?? undefined;
      if (gameState) activeGames.set(roomId, gameState);
    }

    io.to(req.socketId).emit('room:join_approved', {
      room: room!,
      playerId: playerIdNew,
      gameState: gameState ? sanitizeStateFor(gameState, playerIdNew) : undefined,
    });
    io.to(req.socketId).emit('game:paused', pausedRooms.has(roomId));
    io.to(roomId).emit('room:updated', room!);

    removePendingJoinRequest(roomId, requestId);
    cb({ success: true });
  });

  // ============================================================
  // AWAY / BACK
  // ============================================================
  socket.on('player:away', async ({ away }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });

    const { roomId, playerId } = session;
    setPlayerAway(roomId, playerId, away);

    const room = await getFullRoom(roomId);
    if (room) io.to(roomId).emit('room:updated', room);

    cb({ success: true });
  });

  // ============================================================
  // PAUSE / RESUME
  // ============================================================
  socket.on('game:pause', async ({ paused }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });

    const { roomId, playerId } = session;
    const roomData = await getRoom(roomId);
    if (!roomData) return cb({ success: false, error: 'Room not found' });
    if (roomData.host_id !== playerId) return cb({ success: false, error: 'Only host can pause' });

    if (paused) {
      pausedRooms.add(roomId);
      clearActionTimer(roomId);
      clearRunoutTimer(roomId);
    } else {
      pausedRooms.delete(roomId);
      const state = activeGames.get(roomId);
      if (state && state.stage !== 'showdown') {
        if (shouldAutoRunout(state)) startDelayedRunout(io, roomId);
        else scheduleCurrentPlayerAction(io, roomId, state);
      }
    }

    io.to(roomId).emit('game:paused', paused);
    cb({ success: true });
  });

  // ============================================================
  // START GAME
  // ============================================================
  socket.on('game:start', async (cb) => {
    const startedAt = Date.now();
    const session = socketToPlayer.get(socket.id);
    if (!session) {
      console.warn(`[Socket][game:start] rejected reason=no_session socket=${socket.id}`);
      return cb({ success: false, error: 'Not in a room' });
    }

    const { roomId, playerId } = session;
    console.log(`[Socket][game:start] begin room=${roomId} player=${playerId} socket=${socket.id} at=${nowIso()}`);

    const roomData = await getRoom(roomId);
    if (!roomData) {
      console.warn(`[Socket][game:start] rejected reason=room_not_found room=${roomId}`);
      return cb({ success: false, error: 'Room not found' });
    }
    if (roomData.host_id !== playerId) {
      console.warn(`[Socket][game:start] rejected reason=not_host room=${roomId} player=${playerId} host=${roomData.host_id}`);
      return cb({ success: false, error: 'Only host can start' });
    }
    console.log(`[Socket][game:start] room_loaded room=${roomId} status=${roomData.status} loadMs=${Date.now() - startedAt}`);

    const players = await getPlayers(roomId);
    const eligiblePlayers = players.filter(p => p.chips > 0 && !isPlayerAway(roomId, p.id));
    if (eligiblePlayers.length < 2) {
      console.warn(`[Socket][game:start] rejected reason=not_enough_eligible_players room=${roomId} eligible=${eligiblePlayers.length}`);
      return cb({ success: false, error: '至少需要2名玩家' });
    }
    console.log(`[Socket][game:start] players_loaded room=${roomId} total=${players.length} eligible=${eligiblePlayers.length} loadMs=${Date.now() - startedAt}`);

    await updateRoomStatus(roomId, 'playing');
    pausedRooms.delete(roomId);
    clearRunoutTimer(roomId);
    io.to(roomId).emit('game:paused', false);
    console.log(`[Socket][game:start] room_status_updated room=${roomId} status=playing elapsedMs=${Date.now() - startedAt}`);

    const state = initHand(
      eligiblePlayers.map(p => ({
        id: p.id, name: p.name, color: p.color,
        chips: p.chips, isBot: p.isBot, isConnected: p.isConnected,
      })),
      roomData.settings,
      0, // dealerIndex
      1, // handNumber
      roomId
    );
    console.log(`[Socket][game:start] hand_initialized room=${roomId} hand=${state.handNumber} elapsedMs=${Date.now() - startedAt}`);

    activeGames.set(roomId, state);
    await saveGameState(state);
    console.log(`[Socket][game:start] game_state_saved room=${roomId} elapsedMs=${Date.now() - startedAt}`);

    // Broadcast updated room status so clients leave waiting-room UI immediately
    const updatedRoom = await getFullRoom(roomId);
    if (updatedRoom) {
      io.to(roomId).emit('room:updated', updatedRoom);
      console.log(`[Socket][game:start] room_updated_broadcast room=${roomId} status=${updatedRoom.status} elapsedMs=${Date.now() - startedAt}`);
    }

    // Send sanitized state to each player
    broadcastGameState(io, roomId, state);
    console.log(`[Socket][game:start] game_state_broadcast room=${roomId} sockets=${roomSockets.get(roomId)?.size ?? 0} elapsedMs=${Date.now() - startedAt}`);

    cb({ success: true });
    console.log(`[Socket][game:start] ack_sent room=${roomId} totalElapsedMs=${Date.now() - startedAt}`);

    // Schedule bots if needed
    scheduleCurrentPlayerAction(io, roomId, state);
    console.log(`[Socket][game:start] next_action_scheduled room=${roomId} totalElapsedMs=${Date.now() - startedAt}`);
  });

  // ============================================================
  // REVEAL HOLE CARDS (showdown only)
  // ============================================================
  socket.on('game:reveal_cards', async ({ slot }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });

    const { roomId, playerId } = session;
    const state = activeGames.get(roomId);
    if (!state) return cb({ success: false, error: 'No active game' });
    if (state.stage !== 'showdown') return cb({ success: false, error: 'Only available at showdown' });
    if (slot !== 1 && slot !== 2) return cb({ success: false, error: 'Invalid reveal slot' });

    const player = state.players.find((p) => p.id === playerId);
    if (!player) return cb({ success: false, error: 'Player not found' });

    const bit = slot === 1 ? 1 : 2;
    const nextMask = (player.revealedMask ?? 0) | bit;
    player.revealedMask = nextMask;
    player.revealedCount = (nextMask & 1 ? 1 : 0) + (nextMask & 2 ? 1 : 0);
    await saveGameState(state);
    broadcastGameState(io, roomId, state);
    io.to(roomId).emit('game:hand_result', {
      winners: state.winners ?? [],
      players: publicPlayersForShowdown(state),
      pot: state.pot,
      handNumber: state.handNumber,
    });
    cb({ success: true });
  });

  // ============================================================
  // RUN IT TWICE VOTE (heads-up all-in)
  // ============================================================
  socket.on('game:run_it_twice_vote', async ({ agree }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });
    const { roomId, playerId } = session;
    const state = activeGames.get(roomId);
    if (!state) return cb({ success: false, error: 'No active game' });
    if (!state.runItTwice || state.runItTwice.status !== 'pending') {
      return cb({ success: false, error: 'No pending run-it-twice offer' });
    }
    if (!(playerId in state.runItTwice.votes)) {
      return cb({ success: false, error: 'Not eligible to vote' });
    }

    state.runItTwice.votes[playerId] = !!agree;
    const votes = Object.values(state.runItTwice.votes);
    if (votes.some(v => v === false)) {
      state.runItTwice.status = 'declined';
    } else if (votes.every(v => v === true)) {
      state.runItTwice.status = 'agreed';
    }

    await saveGameState(state);
    broadcastGameState(io, roomId, state);
    cb({ success: true });

    if (state.runItTwice.status !== 'pending') {
      startDelayedRunout(io, roomId);
    }
  });

  // ============================================================
  // REBUY OR LEAVE (for busted player between hands)
  // ============================================================
  socket.on('game:rebuy_or_leave', async ({ rebuy, buyIn }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });
    const { roomId, playerId } = session;

    const roomData = await getRoom(roomId);
    if (!roomData) return cb({ success: false, error: 'Room not found' });

    const players = await getPlayers(roomId);
    const player = players.find(p => p.id === playerId);
    if (!player) return cb({ success: false, error: 'Player not found' });
    if (player.chips > 0) return cb({ success: false, error: 'Re-buy only available when busted' });

    setPendingRebuyPrompt(roomId, playerId, false);

    if (!rebuy) {
      await removePlayer(roomId, playerId);
      const sId = roomSockets.get(roomId)?.get(playerId);
      if (sId) {
        io.to(sId).emit('room:player_kicked', { roomId, reason: 'You declined re-buy and left the room.' });
      }
      roomSockets.get(roomId)?.delete(playerId);
      socketToPlayer.delete(socket.id);
      socket.leave(roomId);
    } else {
      const minBuyIn = roomData.settings.bigBlind;
      const nextBuyIn = Math.max(minBuyIn, Math.floor(buyIn ?? roomData.settings.startingChips));
      await updatePlayerChips(roomId, playerId, nextBuyIn);
      setPlayerAway(roomId, playerId, false);
      io.to(roomId).emit('game:player_rebuy', { playerId });
    }

    const room = await getFullRoom(roomId);
    if (room) io.to(roomId).emit('room:updated', room);
    cb({ success: true });

    // Continue flow automatically once decision is made.
    await startNextHand(io, roomId);
  });

  // ============================================================
  // PLAYER ACTION
  // ============================================================
  socket.on('game:action', async ({ action, amount }, cb) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return cb({ success: false, error: 'Not in a room' });

    const { roomId, playerId } = session;
    if (pausedRooms.has(roomId)) return cb({ success: false, error: 'Game is paused' });
    const state = activeGames.get(roomId);
    if (!state) return cb({ success: false, error: 'No active game' });

    // Clear action timer
    clearActionTimer(roomId);

    const { state: newState, error } = applyAction(state, playerId, action, amount);
    if (error) return cb({ success: false, error });

    activeGames.set(roomId, newState);

    // Save to DB async
    saveGameState(newState).catch(console.error);

    cb({ success: true });

    // Broadcast updated state
    broadcastGameState(io, roomId, newState);

    if (newState.stage === 'showdown') {
      finishShowdown(io, roomId, newState);
    } else if (maybeStartRunItTwiceOffer(io, roomId, newState)) {
      // wait for yes/no votes
    } else if (shouldAutoRunout(newState)) {
      startDelayedRunout(io, roomId);
    } else {
      scheduleCurrentPlayerAction(io, roomId, newState);
    }
  });

  // ============================================================
  // NEXT HAND
  // ============================================================
  socket.on('game:next_hand', async () => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return;

    const { roomId } = session;
    await startNextHand(io, roomId);
  });

  // ============================================================
  // CHAT
  // ============================================================
  socket.on('chat:send', async ({ message }) => {
    const session = socketToPlayer.get(socket.id);
    if (!session) return;

    const { roomId, playerId } = session;
    const players = await getPlayers(roomId);
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    const trimmed = message.trim().slice(0, 200);
    if (!trimmed) return;

    const chatMsg = await saveChat(roomId, playerId, player.name, trimmed);
    io.to(roomId).emit('chat:message', chatMsg);
  });

  // ============================================================
  // DISCONNECT
  // ============================================================
  socket.on('disconnect', async () => {
    removePendingRequestsBySocket(socket.id);
    const session = socketToPlayer.get(socket.id);
    if (!session) return;

    const { roomId, playerId } = session;
    socketToPlayer.delete(socket.id);

    const sockets = roomSockets.get(roomId);
    if (sockets) {
      sockets.delete(playerId);
      if (sockets.size === 0) {
        roomSockets.delete(roomId);
        awayPlayersByRoom.delete(roomId);
        pausedRooms.delete(roomId);
        pendingJoinRequestsByRoom.delete(roomId);
        pendingRebuyPromptsByRoom.delete(roomId);
        clearRunoutTimer(roomId);
      }
    }

    await updatePlayerConnection(roomId, playerId, false);
    io.to(roomId).emit('player:disconnected', playerId);

    // Update room
    const room = await getFullRoom(roomId);
    if (room) io.to(roomId).emit('room:updated', room);
  });
}

// ============================================================
// Helpers
// ============================================================

async function getFullRoom(roomId: string) {
  const roomData = await getRoom(roomId);
  if (!roomData) return null;

  const players = await getPlayers(roomId);
  const enrichedPlayers = players.map(p => ({
    ...p,
    isAway: isPlayerAway(roomId, p.id),
  }));
  return {
    id: roomData.id,
    hostId: roomData.host_id,
    status: roomData.status,
    settings: roomData.settings,
    players: enrichedPlayers,
    createdAt: roomData.created_at,
  };
}

function broadcastGameState(
  io: Server,
  roomId: string,
  state: FullGameState
) {
  const sockets = roomSockets.get(roomId);
  if (!sockets) return;

  for (const [playerId, socketId] of sockets) {
    const sanitized = sanitizeStateFor(state, playerId);
    io.to(socketId).emit('game:state', sanitized);
  }
}

function publicPlayersForShowdown(state: FullGameState) {
  return state.players.map((p) => ({
    ...p,
    holeCards:
      (p.revealedMask ?? 0) === 3
        ? p.holeCards.slice(0, 2)
        : (p.revealedMask ?? 0) === 1
          ? (p.holeCards[0] ? [p.holeCards[0]] : [])
          : (p.revealedMask ?? 0) === 2
            ? (p.holeCards[1] ? [p.holeCards[1]] : [])
            : [],
    revealedCount: ((p.revealedMask ?? 0) & 1 ? 1 : 0) + ((p.revealedMask ?? 0) & 2 ? 1 : 0),
  }));
}

function shouldAutoRunout(state: FullGameState): boolean {
  if (state.stage === 'showdown') {
    const phase = state.runItTwice?.phase;
    return state.runItTwice?.status === 'agreed' && phase !== 'final';
  }
  if (state.runItTwice?.status === 'pending') return false;
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length <= 1) return false;
  if (state.playersToAct.length > 0) return false;
  const liveNotAllIn = remaining.filter(p => !p.allIn).length;
  return liveNotAllIn <= 1;
}

function isRunItTwiceEligible(state: FullGameState): boolean {
  if (state.stage === 'showdown') return false;
  if (state.playersToAct.length > 0) return false;
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length !== 2) return false;
  if (!remaining.some(p => p.allIn)) return false;
  if (state.communityCards.length >= 5) return false;
  return true;
}

function maybeStartRunItTwiceOffer(io: Server, roomId: string, state: FullGameState): boolean {
  if (!isRunItTwiceEligible(state)) return false;
  if (state.runItTwice) return state.runItTwice.status === 'pending';

  const remaining = state.players.filter(p => !p.folded);
  const votes: Record<string, boolean | null> = {};
  for (const p of remaining) votes[p.id] = null;
  state.runItTwice = { status: 'pending', votes };
  saveGameState(state).catch(console.error);
  broadcastGameState(io, roomId, state);
  return true;
}

function finishShowdown(io: Server, roomId: string, state: FullGameState): void {
  saveHandHistory(state).catch(console.error);
  for (const p of state.players) {
    if (!p.isBot) updatePlayerChips(roomId, p.id, p.chips).catch(console.error);
  }
  io.to(roomId).emit('game:hand_result', {
    winners: state.winners ?? [],
    players: publicPlayersForShowdown(state),
    pot: state.pot,
    handNumber: state.handNumber,
  });
}

function startDelayedRunout(
  io: Server,
  roomId: string
): void {
  if (runoutTimers.has(roomId)) return;
  if (pausedRooms.has(roomId)) return;
  const state = activeGames.get(roomId);
  if (!state || !shouldAutoRunout(state)) return;
  if (state.runItTwice?.status === 'pending') return;

  const tick = () => {
    runoutTimers.delete(roomId);
    const current = activeGames.get(roomId);
    if (!current) return;
    if (!shouldAutoRunout(current)) return;

    const next = advanceRunoutStreet(current);
    activeGames.set(roomId, next);
    saveGameState(next).catch(console.error);
    broadcastGameState(io, roomId, next);

    const runItTwiceFinalized = next.runItTwice?.status === 'agreed' && next.runItTwice.phase === 'final';
    if (next.stage === 'showdown' && (!next.runItTwice || next.runItTwice.status !== 'agreed' || runItTwiceFinalized)) {
      finishShowdown(io, roomId, next);
      return;
    }

    const timer = setTimeout(tick, 3000);
    runoutTimers.set(roomId, timer);
  };

  const timer = setTimeout(tick, 3000);
  runoutTimers.set(roomId, timer);
}

function scheduleCurrentPlayerAction(
  io: Server,
  roomId: string,
  state: FullGameState
) {
  if (pausedRooms.has(roomId)) return;
  if (state.stage === 'showdown') return;

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (!currentPlayer || currentPlayer.folded || currentPlayer.allIn) return;

  if (currentPlayer.isBot) {
    const decision = decideBotAction(state, currentPlayer.id);
    const delay = getBotThinkTime(decision.action);

    const timer = setTimeout(async () => {
      const freshState = activeGames.get(roomId);
      if (!freshState) return;
      if (freshState.players[freshState.currentPlayerIndex]?.id !== currentPlayer.id) return;

      clearActionTimer(roomId);
      const { state: newState, error } = applyAction(
        freshState, currentPlayer.id, decision.action, decision.amount
      );
      if (error) return;

      activeGames.set(roomId, newState);
      saveGameState(newState).catch(console.error);
      broadcastGameState(io, roomId, newState);

      if (newState.stage === 'showdown') {
        finishShowdown(io, roomId, newState);
      } else if (maybeStartRunItTwiceOffer(io, roomId, newState)) {
        // wait for yes/no votes
      } else if (shouldAutoRunout(newState)) {
        startDelayedRunout(io, roomId);
      } else {
        scheduleCurrentPlayerAction(io, roomId, newState);
      }
    }, delay);

    actionTimers.set(roomId, timer);
  } else {
    // Human timeout is intentionally disabled for now (no auto-fold).
    clearActionTimer(roomId);
  }
}

function clearActionTimer(roomId: string) {
  const t = actionTimers.get(roomId);
  if (t) { clearTimeout(t); actionTimers.delete(roomId); }
}

function clearRunoutTimer(roomId: string) {
  const t = runoutTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    runoutTimers.delete(roomId);
  }
}

async function startNextHand(io: Server, roomId: string) {
  if (pausedRooms.has(roomId)) return;
  clearRunoutTimer(roomId);
  const roomData = await getRoom(roomId);
  if (!roomData) return;

  const players = await getPlayers(roomId);
  const bustedHumans = players.filter(p => !p.isBot && p.chips <= 0 && p.isConnected);
  if (bustedHumans.length > 0) {
    for (const p of bustedHumans) {
      if (hasPendingRebuyPrompt(roomId, p.id)) continue;
      const socketId = roomSockets.get(roomId)?.get(p.id);
      if (!socketId) continue;
      setPendingRebuyPrompt(roomId, p.id, true);
      io.to(socketId).emit('game:rebuy_prompt', {
        minBuyIn: roomData.settings.bigBlind,
        defaultBuyIn: roomData.settings.startingChips,
      });
    }
    return;
  }

  const activePlayers = players.filter(p => p.chips > 0 && !isPlayerAway(roomId, p.id));

  if (activePlayers.length < 2) {
    await updateRoomStatus(roomId, 'finished');
    const room = await getFullRoom(roomId);
    if (room) io.to(roomId).emit('room:updated', room);
    return;
  }

  const prevState = activeGames.get(roomId);
  const newDealerIdx = prevState
    ? (prevState.dealerIndex + 1) % activePlayers.length
    : 0;
  const handNum = (prevState?.handNumber ?? 0) + 1;

  const state = initHand(
    activePlayers.map(p => ({
      id: p.id, name: p.name, color: p.color,
      chips: p.chips, isBot: p.isBot, isConnected: p.isConnected,
    })),
    roomData.settings,
    newDealerIdx,
    handNum,
    roomId
  );

  activeGames.set(roomId, state);
  await saveGameState(state);

  broadcastGameState(io, roomId, state);
  scheduleCurrentPlayerAction(io, roomId, state);
}
