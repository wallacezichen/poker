'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSocket } from '../../../hooks/useSocket';
import { useGameStore } from '../../../store/gameStore';
import WaitingRoom from '../../../components/WaitingRoom';
import GameTable from '../../../components/GameTable';
import { clearRoomIdentity, getRoomIdentity } from '../../../lib/playerSession';
import { GameType } from '../../../types/poker';

const GAME_THEME: Record<GameType, { bg: string; panel: string; badge: string; label: string }> = {
  short_deck: {
    bg: 'radial-gradient(ellipse at center, #1a4a2e 0%, #061510 100%)',
    panel: 'bg-white/5 border border-gold/20',
    badge: 'bg-gradient-to-r from-gold-dark to-gold text-black',
    label: '短牌德州',
  },
  regular: {
    bg: 'radial-gradient(ellipse at center, #132651 0%, #070c1a 100%)',
    panel: 'bg-sky-950/25 border border-sky-300/30',
    badge: 'bg-gradient-to-r from-sky-200 to-cyan-100 text-sky-900',
    label: '德州扑克',
  },
  omaha: {
    bg: 'radial-gradient(ellipse at center, #4f2a11 0%, #140903 100%)',
    panel: 'bg-amber-950/20 border border-amber-200/30',
    badge: 'bg-gradient-to-r from-amber-200 to-yellow-100 text-amber-900',
    label: '奥马哈',
  },
  crazy_pineapple: {
    bg: 'radial-gradient(ellipse at center, #3f0f2f 0%, #14060f 100%)',
    panel: 'bg-fuchsia-950/20 border border-fuchsia-200/30',
    badge: 'bg-gradient-to-r from-fuchsia-200 to-pink-100 text-fuchsia-900',
    label: 'Crazy Pineapple',
  },
};

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = (params?.id as string)?.toUpperCase();

  const {
    startGame, addBot, performAction, sendChat, nextHand,
    leaveRoom, joinRoom, resumeRoom, setAway, setPause, decideJoinRequest, hostManagePlayer, updateRoomSettings, revealCards, voteRunItTwice, respondRebuy,
  } = useSocket();
  const { room, gameState, myPlayerId, isConnected, joinPending, setJoinPending, rebuyPrompt, setRebuyPrompt } = useGameStore();

  const [joining, setJoining] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [rebuyAmount, setRebuyAmount] = useState('');
  const [rebuySubmitting, setRebuySubmitting] = useState(false);
  const queryGameType = (() => {
    const g = (searchParams.get('g') || '').toLowerCase();
    if (g === 'regular' || g === 'short_deck' || g === 'omaha' || g === 'crazy_pineapple') return g as GameType;
    return null;
  })();
  const [roomPreviewGameType, setRoomPreviewGameType] = useState<GameType>(queryGameType || 'short_deck');

  useEffect(() => {
    if (queryGameType) setRoomPreviewGameType(queryGameType);
  }, [queryGameType]);

  useEffect(() => {
    let cancelled = false;
    async function loadRoomPreview() {
      if (!roomId || room) return;
      try {
        const base = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000').replace(/\/$/, '');
        const res = await fetch(`${base}/api/rooms/${roomId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const gt = data?.settings?.gameType;
        if (gt === 'regular' || gt === 'short_deck' || gt === 'omaha' || gt === 'crazy_pineapple') {
          setRoomPreviewGameType(gt);
        }
      } catch {
        // ignore preview fetch failure
      }
    }
    loadRoomPreview();
    return () => { cancelled = true; };
  }, [roomId, room]);

  useEffect(() => {
    let cancelled = false;

    async function tryResume() {
      if (room || !roomId || !isConnected || joinPending || resumeChecked) return;
      const saved = getRoomIdentity(roomId);
      if (!saved?.playerId) {
        setResumeChecked(true);
        setNeedsName(true);
        return;
      }

      setResuming(true);
      const res = await resumeRoom(roomId, saved.playerId);
      if (cancelled) return;
      setResuming(false);
      setResumeChecked(true);

      if (res.success) {
        setNeedsName(false);
      } else {
        clearRoomIdentity(roomId);
        setNeedsName(true);
      }
    }

    tryResume();
    return () => { cancelled = true; };
  }, [room, roomId, isConnected, joinPending, resumeChecked, resumeRoom]);

  async function handleDirectJoin() {
    if (!tempName.trim()) return;
    setJoining(true);
    const res = await joinRoom(roomId, tempName.trim());
    setJoining(false);
    if (!res.success) {
      alert(res.error || '加入失败');
      router.push('/');
    } else {
      setNeedsName(false);
    }
  }

  function handleLeave() {
    leaveRoom();
    router.push('/');
  }

  async function handleStart() {
    console.log(`[Client][WaitingRoom] start_button_clicked room=${roomId} at=${new Date().toISOString()}`);
    const res = await startGame();
    if (!res.success) alert(res.error);
  }

  function handleAction(action: any, amount?: number) {
    performAction(action, amount);
  }

  async function handleSetAway(away: boolean) {
    const res = await setAway(away);
    if (!res.success) alert(res.error || '状态更新失败');
  }

  async function handleSetPause(paused: boolean) {
    const res = await setPause(paused);
    if (!res.success) alert(res.error || '暂停状态更新失败');
  }

  async function handleJoinRequestDecision(requestId: string, approve: boolean, buyIn?: number) {
    const res = await decideJoinRequest(requestId, approve, buyIn);
    if (!res.success) alert(res.error || '审批失败');
  }

  async function handleHostManagePlayer(targetPlayerId: string, action: 'set_chips' | 'kick', chips?: number) {
    const res = await hostManagePlayer(targetPlayerId, action, chips);
    return res;
  }

  async function handleUpdateRoomSettings(settings: Partial<{ smallBlind: number; bigBlind: number; bombPotEnabled: boolean; bombPotAmount: number; bombPotInterval: number; twoSevenEnabled: boolean; twoSevenAmount: number }>) {
    return updateRoomSettings(settings);
  }

  async function handleRevealCards(count: 1 | 2) {
    const res = await revealCards(count);
    if (!res.success) alert(res.error || 'Reveal failed');
  }

  async function handleRunItTwiceVote(agree: boolean) {
    const res = await voteRunItTwice(agree);
    if (!res.success) alert(res.error || 'Vote failed');
  }

  function handleEndSession(rows: Array<{ id: string; name: string; buyIn: number; buyOut: number; net: number }>) {
    try {
      window.sessionStorage.setItem(
        `ledger:${roomId}`,
        JSON.stringify({
          roomId,
          gameType: room?.settings?.gameType ?? 'short_deck',
          rows,
          endedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage failures
    }
    leaveRoom();
    router.push(`/room/${roomId}/settlement`);
  }

  useEffect(() => {
    if (!rebuyPrompt) return;
    setRebuyAmount(String(rebuyPrompt.defaultBuyIn));
  }, [rebuyPrompt?.defaultBuyIn, rebuyPrompt?.minBuyIn]);

  async function handleConfirmRebuy() {
    if (!rebuyPrompt) return;
    const amount = Math.max(rebuyPrompt.minBuyIn, Math.floor(Number(rebuyAmount) || 0));
    if (amount < rebuyPrompt.minBuyIn) {
      alert(`Minimum buy-in is ${rebuyPrompt.minBuyIn}`);
      return;
    }
    setRebuySubmitting(true);
    const res = await respondRebuy(true, amount);
    setRebuySubmitting(false);
    if (!res.success) return alert(res.error || 'Re-buy failed');
    setRebuyPrompt(null);
  }

  async function handleDeclineRebuy() {
    if (!rebuyPrompt) return;
    if (!confirm('Decline re-buy and leave this room?')) return;
    setRebuySubmitting(true);
    const res = await respondRebuy(false);
    setRebuySubmitting(false);
    if (!res.success) return alert(res.error || 'Action failed');
    setRebuyPrompt(null);
    router.push('/');
  }

  // Loading state
  if (!isConnected) {
    const theme = GAME_THEME[roomPreviewGameType];
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.bg }}>
        <div className="text-center">
          <div className="font-display text-gold text-3xl tracking-widest mb-2">连接中...</div>
          <div className="text-white/30 text-sm">正在连接到服务器</div>
        </div>
      </div>
    );
  }

  // Direct link join — ask for name
  if (resuming && !room) {
    const theme = GAME_THEME[roomPreviewGameType];
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: theme.bg }}>
        <div className="text-white/50">恢复玩家身份中...</div>
      </div>
    );
  }

  // Direct link join — ask for name
  if (needsName && !room) {
    const theme = GAME_THEME[roomPreviewGameType];
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: theme.bg }}
      >
        <div className={`w-full max-w-sm rounded-2xl p-8 text-center ${theme.panel}`}>
          <span className={`inline-block text-xs font-bold px-3 py-1 rounded-full mb-3 ${theme.badge}`}>
            {theme.label}
          </span>
          <div className="font-display text-4xl text-gold tracking-widest mb-2">加入房间</div>
          <div className="text-white/40 text-sm mb-6">房间码: <span className="text-gold font-display text-lg">{roomId}</span></div>

          <div className="mb-4">
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDirectJoin()}
              placeholder="输入你的昵称..."
              maxLength={12}
              className="w-full bg-black/30 border border-gold/20 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-gold transition-colors text-center"
              autoFocus
            />
          </div>

          <button
            onClick={handleDirectJoin}
            disabled={joining || !tempName.trim()}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-gold-dark to-gold text-black font-display text-xl tracking-widest hover:brightness-110 transition-all disabled:opacity-50"
          >
            {joining ? '加入中...' : '加入游戏'}
          </button>

          <button
            onClick={() => router.push('/')}
            className="mt-3 text-white/30 hover:text-white/60 text-sm w-full transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    if (joinPending && joinPending.roomId === roomId) {
      const theme = GAME_THEME[roomPreviewGameType];
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: theme.bg }}>
          <div className="w-full max-w-md bg-black/35 border border-white/20 rounded-xl p-6 text-center text-white">
            <div className="text-2xl font-semibold mb-2">
              {joinPending.status === 'pending' ? '等待房主审批加入请求' : '加入请求被拒绝'}
            </div>
            <div className="text-white/65 text-sm mb-6">
              房间: {roomId}
              {joinPending.error ? ` · ${joinPending.error}` : ''}
            </div>
            <div className="flex items-center justify-center gap-3">
              {joinPending.status === 'denied' && (
                <button
                  onClick={() => {
                    setJoinPending(null);
                    setNeedsName(true);
                  }}
                  className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30"
                >
                  重新申请
                </button>
              )}
              <button
                onClick={() => {
                  setJoinPending(null);
                  router.push('/');
                }}
                className="px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#061510' }}>
        <div className="text-white/30">加载房间中...</div>
      </div>
    );
  }

  // Show waiting room until the first game state arrives.
  // Do not block on room.status because it may lag behind socket state.
  if (!gameState) {
    return (
      <WaitingRoom
        room={room}
        myPlayerId={myPlayerId || ''}
        onStart={handleStart}
        onAddBot={addBot}
        onLeave={handleLeave}
      />
    );
  }

  return (
    <div className="relative">
      <GameTable
        gameState={gameState}
        room={room}
        myPlayerId={myPlayerId || ''}
        onAction={handleAction}
        onSendChat={sendChat}
        onSetAway={handleSetAway}
        onJoinRequestDecision={handleJoinRequestDecision}
        onHostManagePlayer={handleHostManagePlayer}
        onUpdateRoomSettings={handleUpdateRoomSettings}
        onSetPause={handleSetPause}
        onNextHand={nextHand}
        onRevealCards={handleRevealCards}
        onRunItTwiceVote={handleRunItTwiceVote}
        onEndSession={handleEndSession}
        onLeave={handleLeave}
      />
      {rebuyPrompt && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-xl border border-white/25 bg-[#10151f] p-5 text-white shadow-[0_20px_48px_rgba(0,0,0,0.5)]">
            <div className="text-lg font-bold">You are out of chips</div>
            <div className="mt-2 text-sm text-white/75">
              Buy back in to continue this room.
            </div>
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-white/50">Buy-in Amount</div>
              <input
                type="number"
                min={rebuyPrompt.minBuyIn}
                step={1}
                value={rebuyAmount}
                onChange={(e) => setRebuyAmount(e.target.value)}
                className="w-full rounded border border-white/25 bg-black/35 px-3 py-2 text-white outline-none focus:border-emerald-400"
              />
              <div className="mt-1 text-xs text-white/55">Minimum: {rebuyPrompt.minBuyIn}</div>
            </div>
            <div className="mt-5 flex items-center gap-2">
              <button
                disabled={rebuySubmitting}
                onClick={handleConfirmRebuy}
                className="flex-1 rounded bg-emerald-600 px-3 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {rebuySubmitting ? 'Processing...' : 'Re-buy In'}
              </button>
              <button
                disabled={rebuySubmitting}
                onClick={handleDeclineRebuy}
                className="flex-1 rounded bg-rose-700 px-3 py-2 font-semibold hover:bg-rose-600 disabled:opacity-50"
              >
                Decline & Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
