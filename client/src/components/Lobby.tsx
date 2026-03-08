'use client';
import { useState } from 'react';
import clsx from 'clsx';

interface LobbyProps {
  onCreateRoom: (name: string, settings: any) => Promise<{ success: boolean; error?: string }>;
  onJoinRoom: (roomId: string, name: string) => Promise<{ success: boolean; error?: string }>;
  isConnected: boolean;
  initialRoomId?: string;
}

const STARTING_CHIPS_OPTIONS = [
  { label: '1,000', value: 1000 },
  { label: '3,000', value: 3000 },
  { label: '5,000', value: 5000 },
];

const BLIND_OPTIONS = [
  { label: '5/10', small: 5, big: 10 },
  { label: '10/20', small: 10, big: 20 },
  { label: '25/50', small: 25, big: 50 },
  { label: '50/100', small: 50, big: 100 },
];

export default function Lobby({ onCreateRoom, onJoinRoom, isConnected, initialRoomId }: LobbyProps) {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoomId || '');
  const [startingChips, setStartingChips] = useState(1000);
  const [blindIdx, setBlindIdx] = useState(0); // 5/10
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreateSettings, setShowCreateSettings] = useState(false);

  async function handleCreate() {
    if (!playerName.trim()) { setError('请输入昵称'); return; }
    setLoading(true); setError('');
    const blind = BLIND_OPTIONS[blindIdx];
    const res = await onCreateRoom(playerName.trim(), {
      startingChips,
      smallBlind: blind.small,
      bigBlind: blind.big,
    });
    setLoading(false);
    if (!res.success) setError(res.error || '创建失败');
  }

  async function handleJoin() {
    if (!playerName.trim()) { setError('请输入昵称'); return; }
    if (!joinCode.trim()) { setError('请输入房间码'); return; }
    setLoading(true); setError('');
    const res = await onJoinRoom(joinCode.trim().toUpperCase(), playerName.trim());
    setLoading(false);
    if (!res.success) setError(res.error || '加入失败');
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at center, #1a4a2e 0%, #061510 100%)' }}
    >
      {/* Logo */}
      <div className="mb-8 text-center">
        <h1 className="font-display text-[4.5rem] md:text-[7rem] text-gold tracking-[6px] leading-none"
          style={{ textShadow: '0 0 40px rgba(212,168,71,0.4), 3px 3px 0 #8b6914' }}
        >
          短牌扑克
        </h1>
        <p className="text-white/40 tracking-[6px] text-xs uppercase mt-2">Short Deck Texas Hold'em</p>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <div className={clsx('w-2 h-2 rounded-full', isConnected ? 'bg-green-400' : 'bg-red-400')} />
          <span className="text-xs text-white/30">{isConnected ? '已连接' : '连接中...'}</span>
        </div>
      </div>

      {/* Main card */}
      <div className="w-full max-w-md bg-white/5 border border-gold/20 rounded-2xl p-6 backdrop-blur-sm">
        {/* Name input */}
        <div className="mb-5">
          <label className="text-xs text-white/40 uppercase tracking-widest block mb-2">你的昵称</label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="输入昵称..."
            maxLength={12}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full bg-black/30 border border-gold/20 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-gold transition-colors"
          />
        </div>

        {/* Create Room */}
        <div className="mb-3">
          <button
            onClick={() => setShowCreateSettings(!showCreateSettings)}
            className="text-xs text-white/40 hover:text-gold mb-2 flex items-center gap-1 transition-colors"
          >
            ⚙️ 游戏设置 {showCreateSettings ? '▲' : '▼'}
          </button>

          {showCreateSettings && (
            <div className="bg-black/20 rounded-xl p-4 mb-3 border border-white/5 space-y-3">
              <div>
                <label className="text-xs text-white/40 block mb-2">初始筹码</label>
                <div className="flex gap-2 flex-wrap">
                  {STARTING_CHIPS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setStartingChips(opt.value)}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-sm border transition-all',
                        startingChips === opt.value
                          ? 'bg-gold/80 text-black border-gold'
                          : 'bg-white/5 text-white/60 border-white/10 hover:border-white/30'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-2">盲注</label>
                <div className="flex gap-2 flex-wrap">
                  {BLIND_OPTIONS.map((opt, i) => (
                    <button
                      key={opt.label}
                      onClick={() => setBlindIdx(i)}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-sm border transition-all',
                        blindIdx === i
                          ? 'bg-gold/80 text-black border-gold'
                          : 'bg-white/5 text-white/60 border-white/10 hover:border-white/30'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || !isConnected}
            className={clsx(
              'w-full py-3.5 rounded-xl font-display text-2xl tracking-widest transition-all',
              'bg-gradient-to-r from-gold-dark via-gold to-gold-light text-black',
              'hover:brightness-110 active:scale-95 shadow-gold-glow',
              (loading || !isConnected) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {loading ? '...' : '🎴 创建房间'}
          </button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-transparent text-white/30 text-xs px-2">或者加入房间</span>
          </div>
        </div>

        {/* Join Room */}
        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="输入房间码"
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-gold transition-colors uppercase tracking-widest font-display text-lg"
          />
          <button
            onClick={handleJoin}
            disabled={loading || !isConnected}
            className={clsx(
              'px-5 py-3 rounded-xl border border-white/15 text-white/70 hover:bg-white/5 transition-all',
              'font-medium text-sm',
              (loading || !isConnected) && 'opacity-50 cursor-not-allowed'
            )}
          >
            加入
          </button>
        </div>

        {error && (
          <div className="mt-3 text-red-400 text-sm bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

    </div>
  );
}
