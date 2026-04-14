'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useGameStore } from '../store/gameStore';
import { ClientToServerEvents, ServerToClientEvents, RoomSettings, ActionType, GameState, HandResultPayload } from '../types/poker';
import { playBetSound, playCheckSound, playFlopSound, playHoleCardsSound, playRiverSound, playTurnSound, playWinnerSound } from '../lib/soundEffects';
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
    setGameState, setHandResult, addChatMessage, setChatMessages,
    setShowHandResult, setGamePaused, addJoinRequest, removeJoinRequest, clearJoinRequests, setJoinPending, setRebuyPrompt, addRebuyBadgePlayer, setRebuyCountMap,
  } = useGameStore();

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streetRevealDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayedStateRef = useRef<GameState | null>(null);
  const prevStateRef = useRef<GameState | null>(null);
  const lastWinnerSoundKeyRef = useRef<string | null>(null);
  const pendingHandResultRef = useRef<HandResultPayload | null>(null);

  useEffect(() => {
    const s = getSocket();

    if (!s.connected) s.connect();

    const onConnect = () => {
      setConnected(true);
      const { room, myPlayerId } = useGameStore.getState();
      // After transient disconnect/reconnect, socket.id changes and server session is lost.
      // Re-bind this socket to the same player session if we already have local room identity.
      if (room?.id && myPlayerId) {
        s.emit('room:resume', { roomId: room.id, playerId: myPlayerId }, (res) => {
          if (res.success && res.room && res.playerId) {
            setRoom(res.room);
            setMyPlayerId(res.playerId);
            if (res.gameState) setGameState(res.gameState);
            if (res.chatHistory) setChatMessages(res.chatHistory);
            const me = res.room.players.find((p) => p.id === res.playerId);
            saveRoomIdentity(res.room.id, res.playerId, me?.name);
          } else if (res.error) {
            console.warn('[Socket] auto-resume failed:', res.error);
          }
        });
      }
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      console.warn('[Socket] disconnected:', reason);
    };
    const onConnectError = (err: Error) => {
      console.warn('[Socket] connect_error:', err.message);
    };
    const onReconnectAttempt = (attempt: number) => {
      console.log('[Socket] reconnect_attempt:', attempt);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.io.on('reconnect_attempt', onReconnectAttempt);

    s.on('room:updated', (room) => setRoom(room));
    s.on('room:join_request', (req) => addJoinRequest(req));
    s.on('room:join_approved', ({ room, playerId, gameState, chatHistory }) => {
      setRoom(room);
      setMyPlayerId(playerId);
      if (gameState) setGameState(gameState);
      if (chatHistory) setChatMessages(chatHistory);
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
    s.on('room:player_kicked', ({ reason }) => {
      alert(reason || 'You were removed from this room by host.');
      clearJoinRequests();
      setJoinPending(null);
      useGameStore.getState().reset();
    });

    const applyIncomingState = (state: GameState) => {
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
      const isCheckAction = currLastAction?.action === 'check';
      const isMyOwnAction = !!(currLastAction && myId && currLastAction.playerId === myId);
      const playedBetSound = !!(isNewAction && isBetLikeAction && !isMyOwnAction);
      const playedCheckSound = !!(isNewAction && isCheckAction && !isMyOwnAction);
      if (playedBetSound) {
        playBetSound();
      } else if (playedCheckSound) {
        playCheckSound();
      }

      // If this same state update already played a bet/chip sound,
      // skip stage-reveal tap to avoid double-SFX overlap.
      if (!playedBetSound && !playedCheckSound && prev && prev.stage !== state.stage) {
        if (state.stage === 'flop') playFlopSound();
        if (state.stage === 'turn') playTurnSound();
        if (state.stage === 'river') playRiverSound();
      }

      setGameState(state);
      prevStateRef.current = state;
      // Timer UI is intentionally disabled for now.
      stopTimer();
      useGameStore.getState().setTimerSeconds(0);
    };

    s.on('game:state', (state) => {
      const prev = prevStateRef.current;
      const prevLastAction = prev?.actionLog?.[prev.actionLog.length - 1];
      const currLastAction = state.actionLog?.[state.actionLog.length - 1];
      const isNewAction = !!currLastAction && currLastAction.timestamp !== prevLastAction?.timestamp;
      const isDecisionAction = (a?: string) => a === 'check' || a === 'call' || a === 'raise' || a === 'allin';
      const isStreetReveal =
        !!prev &&
        prev.stage !== state.stage &&
        (state.stage === 'flop' || state.stage === 'turn' || state.stage === 'river' || state.stage === 'showdown');
      const isRiverToShowdownAfterAction =
        !!prev &&
        prev.stage === 'river' &&
        state.stage === 'showdown' &&
        isDecisionAction(prevLastAction?.action);
      const shouldClientSuspense =
        isStreetReveal &&
        (
          (isNewAction && !!currLastAction && isDecisionAction(currLastAction.action)) ||
          isRiverToShowdownAfterAction
        );

      if (shouldClientSuspense && prev) {
        if (streetRevealDelayRef.current) clearTimeout(streetRevealDelayRef.current);
        delayedStateRef.current = state;
        const prevBetById = new Map(prev.players.map((p) => [p.id, p.bet]));
        const suspensePlayers = state.players.map((p) => ({
          ...p,
          bet: Number(prevBetById.get(p.id) || 0),
        }));
        if (currLastAction && (currLastAction.action === 'call' || currLastAction.action === 'raise' || currLastAction.action === 'allin')) {
          const idx = suspensePlayers.findIndex((p) => p.id === currLastAction.playerId);
          if (idx >= 0 && Number(currLastAction.amount || 0) > 0) {
            suspensePlayers[idx] = {
              ...suspensePlayers[idx],
              bet: Number(currLastAction.amount || 0),
            };
          }
        }

        const suspenseState: GameState = {
          ...state,
          stage: prev.stage,
          communityCards: prev.communityCards,
          currentPlayerIndex: -1,
          players: suspensePlayers,
          winners: undefined,
        };
        for (const p of suspenseState.players) {
          p.handResult = undefined;
          p.runItTwiceHandNamesZh = undefined;
        }
        applyIncomingState(suspenseState);
        streetRevealDelayRef.current = setTimeout(() => {
          applyIncomingState(delayedStateRef.current || state);
          delayedStateRef.current = null;
          if (pendingHandResultRef.current) {
            const result = pendingHandResultRef.current;
            pendingHandResultRef.current = null;
            setHandResult(result);
            setShowHandResult(true);
            const myId = useGameStore.getState().myPlayerId;
            const amIWinner = !!myId && result.winners.some((w) => w.playerId === myId);
            const roomId = useGameStore.getState().room?.id ?? '';
            const handKey = `${roomId}:${result.handNumber}`;
            if (amIWinner && lastWinnerSoundKeyRef.current !== handKey) {
              playWinnerSound();
              lastWinnerSoundKeyRef.current = handKey;
            }
            stopTimer();
          }
          streetRevealDelayRef.current = null;
        }, 1500);
        return;
      }

      if (streetRevealDelayRef.current) {
        // Keep suspense timer running; only refresh the pending final state.
        delayedStateRef.current = state;
        return;
      }
      applyIncomingState(state);
    });

    s.on('game:hand_result', (result) => {
      if (streetRevealDelayRef.current) {
        pendingHandResultRef.current = result;
        return;
      }
      setHandResult(result);
      setShowHandResult(true);
      const myId = useGameStore.getState().myPlayerId;
      const amIWinner = !!myId && result.winners.some((w) => w.playerId === myId);
      const roomId = useGameStore.getState().room?.id ?? '';
      const handKey = `${roomId}:${result.handNumber}`;
      if (amIWinner && lastWinnerSoundKeyRef.current !== handKey) {
        playWinnerSound();
        lastWinnerSoundKeyRef.current = handKey;
      }
      stopTimer();
    });

    s.on('chat:message', (msg) => addChatMessage(msg));
    s.on('game:paused', (paused) => setGamePaused(paused));
    s.on('game:rebuy_prompt', (payload) => setRebuyPrompt(payload));
    s.on('game:player_rebuy', ({ playerId }) => addRebuyBadgePlayer(playerId));
    s.on('game:rebuy_counts', ({ counts }) => setRebuyCountMap(counts || {}));

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
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.io.off('reconnect_attempt', onReconnectAttempt);
      s.off('room:updated');
      s.off('room:join_request');
      s.off('room:join_approved');
      s.off('room:join_denied');
      s.off('room:player_kicked');
      s.off('game:state');
      s.off('game:hand_result');
      s.off('chat:message');
      s.off('game:paused');
      s.off('game:rebuy_prompt');
      s.off('game:player_rebuy');
      s.off('game:rebuy_counts');
      s.off('player:disconnected');
      s.off('player:connected');
      stopTimer();
      if (streetRevealDelayRef.current) {
        clearTimeout(streetRevealDelayRef.current);
        streetRevealDelayRef.current = null;
      }
      delayedStateRef.current = null;
      pendingHandResultRef.current = null;
      prevStateRef.current = null;
      lastWinnerSoundKeyRef.current = null;
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
          if (res.chatHistory) setChatMessages(res.chatHistory);
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
          if (res.chatHistory) setChatMessages(res.chatHistory);
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

  function hostManagePlayer(targetPlayerId: string, action: 'set_chips' | 'kick', chips?: number) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ success: false, error: 'Server timeout. Please redeploy backend or retry.' });
      }, 8000);

      getSocket().emit('room:host_manage_player', { targetPlayerId, action, chips }, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  function updateRoomSettings(settings: Partial<Pick<RoomSettings, 'smallBlind' | 'bigBlind' | 'bombPotEnabled' | 'bombPotAmount' | 'bombPotInterval' | 'twoSevenEnabled' | 'twoSevenAmount' | 'gameType'>>) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('room:update_settings', { settings }, (res) => resolve(res));
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

  function revealCards(slot: 1 | 2 | 3) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:reveal_cards', { slot }, (res) => resolve(res));
    });
  }

  function revealDeadBoard() {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:reveal_dead_board', (res) => resolve(res));
    });
  }

  function voteRunItTwice(agree: boolean) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:run_it_twice_vote', { agree }, (res) => resolve(res));
    });
  }

  function respondRebuy(rebuy: boolean, buyIn?: number) {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      getSocket().emit('game:rebuy_or_leave', { rebuy, buyIn }, (res) => resolve(res));
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
    lastWinnerSoundKeyRef.current = null;
    useGameStore.getState().reset();
  }

  return {
    createRoom,
    joinRoom,
    resumeRoom,
    addBot,
    setAway,
    decideJoinRequest,
    hostManagePlayer,
    updateRoomSettings,
    setPause,
    startGame,
    performAction,
    revealCards,
    revealDeadBoard,
    voteRunItTwice,
    respondRebuy,
    sendChat,
    nextHand,
    leaveRoom,
  };
}
