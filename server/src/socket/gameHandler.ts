import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ClientToServerEvents, ServerToClientEvents, RoomSettings, RoomPlayer } from '../types/poker';
import { initHand, applyAction, sanitizeStateFor, FullGameState } from '../game/engine';
import { decideBotAction, getBotThinkTime } from '../game/botAI';
import {
  createRoom, getRoom, updateRoomStatus, upsertPlayer,
  updatePlayerChips, updatePlayerConnection, getPlayers,
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
// Map roomId -> players marked away (observer only, skipped in next hands)
const awayPlayersByRoom = new Map<string, Set<string>>();
// Room pause state
const pausedRooms = new Set<string>();
type PendingJoinRequest = { requestId: string; roomId: string; playerName: string; socketId: string; requestedAt: string };
const pendingJoinRequestsByRoom = new Map<string, Map<string, PendingJoinRequest>>();

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
    } else {
      pausedRooms.delete(roomId);
      const state = activeGames.get(roomId);
      if (state && state.stage !== 'showdown') {
        scheduleCurrentPlayerAction(io, roomId, state);
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
      // Save hand history
      saveHandHistory(newState).catch(console.error);
      // Update chips in DB
      for (const p of newState.players) {
        if (!p.isBot) {
          updatePlayerChips(roomId, p.id, p.chips).catch(console.error);
        }
      }
      // Emit hand result
      io.to(roomId).emit('game:hand_result', {
        winners: newState.winners!,
        players: newState.players,
        pot: newState.pot,
        handNumber: newState.handNumber,
      });
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
        saveHandHistory(newState).catch(console.error);
        io.to(roomId).emit('game:hand_result', {
          winners: newState.winners!,
          players: newState.players,
          pot: newState.pot,
          handNumber: newState.handNumber,
        });
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

async function startNextHand(io: Server, roomId: string) {
  if (pausedRooms.has(roomId)) return;
  const roomData = await getRoom(roomId);
  if (!roomData) return;

  const players = await getPlayers(roomId);
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
