'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore';
import { ClientToServerEvents, ServerToClientEvents, RoomSettings, ActionType, GameState } from '../types/poker';
import { playBetSound, playFlopSound, playHoleCardsSound, playRiverSound, playTurnSound } from '../lib/soundEffects';
import { saveRoomIdentity } from '../lib/playerSession';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket() {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000', {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function useSocket() {
  const {
    setConnected, setRoom, setMyPlayerId,
    setGameState, setHandResult, addChatMessage,
    setShowHandResult, setGamePaused, addJoinRequest, removeJoinRequest, clearJoinRequests, setJoinPending,
  } = useGameStore();

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    const s = getSocket();

    if (!s.connected) s.connect();

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('room:updated', (room) => setRoom(room));
    s.on('room:join_request', (req) => addJoinRequest(req));
    s.on('room:join_approved', ({ room, playerId, gameState }) => {
      setRoom(room);
      setMyPlayerId(playerId);
      if (gameState) setGameState(gameState);
      const me = room.players.find((p) => p.id === playerId);
      saveRoomIdentity(room.id, playerId, me?.name);
      setJoinPending(null);
    });
    s.on('room:join_denied', ({ error }) => {
      const pending = useGameStore.getState().joinPending;
      if (pending) {
        setJoinPending({ ...pending, status: 'denied', error: error || 'Host denied your request' });
      }
    });

    s.on('game:state', (state) => {
      const prev = prevStateRef.current;
      const myId = useGameStore.getState().myPlayerId;
      const prevMe = prev?.players.find((p) => p.id === myId);
      const currMe = state.players.find((p) => p.id === myId);
      const handChanged = !prev || prev.handNumber !== state.handNumber;
      const gotHoleCardsNow = (currMe?.holeCards?.length ?? 0) >= 2 && (prevMe?.holeCards?.length ?? 0) < 2;

      if (prev && handChanged) {
        setShowHandResult(false);
        setHandResult(null);
      }

      if (handChanged && gotHoleCardsNow) {
        playHoleCardsSound();
      }

      if (prev && prev.stage !== state.stage) {
        if (state.stage === 'flop') playFlopSound();
        if (state.stage === 'turn') playTurnSound();
        if (state.stage === 'river') playRiverSound();
      }

      const prevLastAction = prev?.actionLog?.[prev.actionLog.length - 1];
      const currLastAction = state.actionLog?.[state.actionLog.length - 1];
      const isNewAction = !!currLastAction && currLastAction.timestamp !== prevLastAction?.timestamp;
      const isBetLikeAction = currLastAction && (
        currLastAction.action === 'blind_small' ||
        currLastAction.action === 'blind_big' ||
        currLastAction.action === 'call' ||
        currLastAction.action === 'raise' ||
        currLastAction.action === 'allin'
      );
      if (isNewAction && isBetLikeAction) {
        playBetSound();
      }

      setGameState(state);
      prevStateRef.current = state;
      // Timer UI is intentionally disabled for now.
      stopTimer();
      useGameStore.getState().setTimerSeconds(0);
    });

    s.on('game:hand_result', (result) => {
      setHandResult(result);
      setShowHandResult(true);
      stopTimer();
    });

    s.on('chat:message', (msg) => addChatMessage(msg));
    s.on('game:paused', (paused) => setGamePaused(paused));

    s.on('player:disconnected', (playerId) => {
      const room = useGameStore.getState().room;
      if (room) {
        setRoom({
          ...room,
          players: room.players.map(p =>
            p.id === playerId ? { ...p, isConnected: false } : p
          ),
        });
      }
    });

    s.on('player:connected', (playerId) => {
      const room = useGameStore.getState().room;
      if (room) {
        setRoom({
          ...room,
          players: room.players.map(p =>
            p.id === playerId ? { ...p, isConnected: true } : p
          ),
        });
      }
    });

    return () => {
      s.off('connect');
      s.off('disconnect');
      s.off('room:updated');
      s.off('room:join_request');
      s.off('room:join_approved');
      s.off('room:join_denied');
      s.off('game:state');
      s.off('game:hand_result');
      s.off('chat:message');
      s.off('game:paused');
      s.off('player:disconnected');
      s.off('player:connected');
      stopTimer();
      prevStateRef.current = null;
    };
  }, []);

  function startTimer() {
    // Disabled intentionally.
    stopTimer();
    useGameStore.getState().setTimerSeconds(0);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // ============================================================
  // Actions
  // ============================================================

  function createRoom(playerName: string, settings: Partial<RoomSettings>) {
    return new Promise<{ success: boolean; error?: string; roomId?: string }>((resolve) => {
      getSocket().emit('room:create', { playerName, settings }, (res) => {
        if (res.success && res.room && res.playerId) {
          setRoom(res.room);
          setMyPlayerId(res.playerId);
          saveRoomIdentity(res.room.id, res.playerId, playerName);
          resolve({ success: true, roomId: res.room.id });
        } else {
          resolve({ success: false, error: res.error });
        }
      });
    });
  }

  function joinRoom(roomId: string, playerName: string) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('room:join', { roomId, playerName }, (res) => {
        if (res.success && res.room && res.playerId) {
          setRoom(res.room);
          setMyPlayerId(res.playerId);
          if (res.gameState) setGameState(res.gameState);
          saveRoomIdentity(res.room.id, res.playerId, playerName);
          setJoinPending(null);
          resolve({ success: true });
        } else if (res.success && res.pendingApproval) {
          setJoinPending({ roomId, requestId: res.requestId, status: 'pending' });
          resolve({ success: true });
        } else {
          resolve({ success: false, error: res.error });
        }
      });
    });
  }

  function resumeRoom(roomId: string, playerId: string) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('room:resume', { roomId, playerId }, (res) => {
        if (res.success && res.room && res.playerId) {
          setRoom(res.room);
          setMyPlayerId(res.playerId);
          if (res.gameState) setGameState(res.gameState);
          const me = res.room.players.find((p) => p.id === res.playerId);
          saveRoomIdentity(res.room.id, res.playerId, me?.name);
          setJoinPending(null);
          resolve({ success: true });
        } else {
          resolve({ success: false, error: res.error });
        }
      });
    });
  }

  function addBot() {
    return new Promise<void>((resolve) => {
      getSocket().emit('room:add_bot', () => resolve());
    });
  }

  function setAway(away: boolean) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('player:away', { away }, (res) => resolve(res));
    });
  }

  function decideJoinRequest(requestId: string, approve: boolean, buyIn?: number) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('room:join_request_decision', { requestId, approve, buyIn }, (res) => {
        if (res.success) removeJoinRequest(requestId);
        resolve(res);
      });
    });
  }

  function setPause(paused: boolean) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:pause', { paused }, (res) => resolve(res));
    });
  }

  function startGame() {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      const startedAt = Date.now();
      const roomId = useGameStore.getState().room?.id;
      console.log(`[Client][game:start] emit room=${roomId ?? 'unknown'} at=${new Date(startedAt).toISOString()}`);
      getSocket().emit('game:start', (res) => {
        const elapsed = Date.now() - startedAt;
        console.log(
          `[Client][game:start] ack success=${res.success} elapsedMs=${elapsed}` +
          `${res.error ? ` error="${res.error}"` : ''}`
        );
        resolve(res);
      });
    });
  }

  function performAction(action: ActionType, amount?: number) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:action', { action, amount }, (res) => resolve(res));
    });
  }

  function sendChat(message: string) {
    getSocket().emit('chat:send', { message });
  }

  function nextHand() {
    getSocket().emit('game:next_hand');
  }

  function leaveRoom() {
    getSocket().emit('room:leave');
    clearJoinRequests();
    setJoinPending(null);
    prevStateRef.current = null;
    useGameStore.getState().reset();
  }

  return {
    createRoom,
    joinRoom,
    resumeRoom,
    addBot,
    setAway,
    decideJoinRequest,
    setPause,
    startGame,
    performAction,
    sendChat,
    nextHand,
    leaveRoom,
  };
}
