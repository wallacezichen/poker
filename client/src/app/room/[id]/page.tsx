'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '../../../hooks/useSocket';
import { useGameStore } from '../../../store/gameStore';
import WaitingRoom from '../../../components/WaitingRoom';
import GameTable from '../../../components/GameTable';
import { clearRoomIdentity, getRoomIdentity } from '../../../lib/playerSession';

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = (params?.id as string)?.toUpperCase();

  const {
    startGame, addBot, performAction, sendChat, nextHand,
    leaveRoom, joinRoom, resumeRoom, setAway, setPause, decideJoinRequest, hostManagePlayer, revealCards,
  } = useSocket();
  const { room, gameState, myPlayerId, isConnected, joinPending, setJoinPending } = useGameStore();

  const [joining, setJoining] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [resuming, setResuming] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);

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

  async function handleRevealCards(count: 1 | 2) {
    const res = await revealCards(count);
    if (!res.success) alert(res.error || 'Reveal failed');
  }

  // Loading state
  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#061510' }}>
        <div className="text-center">
          <div className="font-display text-gold text-3xl tracking-widest mb-2">连接中...</div>
          <div className="text-white/30 text-sm">正在连接到服务器</div>
        </div>
      </div>
    );
  }

  // Direct link join — ask for name
  if (resuming && !room) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#061510' }}>
        <div className="text-white/50">恢复玩家身份中...</div>
      </div>
    );
  }

  // Direct link join — ask for name
  if (needsName && !room) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'radial-gradient(ellipse at center, #1a4a2e 0%, #061510 100%)' }}
      >
        <div className="w-full max-w-sm bg-white/5 border border-gold/20 rounded-2xl p-8 text-center">
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
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#061510' }}>
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
    <GameTable
      gameState={gameState}
      room={room}
      myPlayerId={myPlayerId || ''}
      onAction={handleAction}
      onSendChat={sendChat}
      onSetAway={handleSetAway}
      onJoinRequestDecision={handleJoinRequestDecision}
      onHostManagePlayer={handleHostManagePlayer}
      onSetPause={handleSetPause}
      onNextHand={nextHand}
      onRevealCards={handleRevealCards}
      onLeave={handleLeave}
    />
  );
}
