'use client';
import { useState } from 'react';
import { Room } from '../types/poker';
import clsx from 'clsx';

interface WaitingRoomProps {
  room: Room;
  myPlayerId: string;
  onStart: () => void;
  onAddBot: () => void;
  onLeave: () => void;
}

function formatChips(n: number): string {
  return n.toLocaleString();
}

export default function WaitingRoom({ room, myPlayerId, onStart, onAddBot, onLeave }: WaitingRoomProps) {
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === myPlayerId;
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/room/${room.id}`
    : `/room/${room.id}`;

  function copyLink() {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at center, #1a4a2e 0%, #0a1f12 100%)' }}
    >
      <div className="w-full max-w-lg bg-white/5 border border-gold/20 rounded-2xl p-8 backdrop-blur-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <span className="inline-block bg-gradient-to-r from-gold-dark to-gold text-black text-xs font-bold px-3 py-1 rounded-full mb-3">
            短牌德州
          </span>
          <h1 className="font-display text-4xl text-gold tracking-widest">等待玩家加入</h1>
        </div>

        {/* Room code */}
        <div className="text-center mb-4">
          <div className="text-xs text-white/40 uppercase tracking-widest mb-1">房间码</div>
          <div
            onClick={copyLink}
            className="font-display text-5xl text-gold tracking-[12px] bg-black/30 rounded-xl py-3 cursor-pointer hover:bg-gold/10 transition-colors border border-gold/10"
          >
            {room.id}
          </div>
        </div>

        {/* Share link */}
        <div
          onClick={copyLink}
          className={clsx(
            'bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs cursor-pointer transition-all mb-1',
            'hover:bg-gold/5 hover:border-gold/20 text-center',
            copied && 'border-green-500/50 bg-green-900/20 text-green-400'
          )}
        >
          {copied ? '✓ 链接已复制!' : shareLink}
        </div>
        <p className="text-[0.7rem] text-white/30 text-center mb-6">点击复制链接 · 发给朋友</p>

        {/* Players */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/40 uppercase tracking-widest">玩家列表</span>
            <span className="text-xs text-white/40">{room.players.length}/{room.settings.maxPlayers}</span>
          </div>

          <div className="space-y-2">
            {room.players.map((player, i) => (
              <div
                key={player.id}
                className={clsx(
                  'flex items-center gap-3 bg-black/20 rounded-xl px-4 py-2.5 border',
                  player.id === myPlayerId ? 'border-blue-400/30 bg-blue-900/10' : 'border-white/5'
                )}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ background: player.color }}
                >
                  {player.name[0]}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-white">
                    {player.name}
                    {player.isBot && <span className="text-white/40 ml-1">🤖</span>}
                    {player.id === myPlayerId && <span className="text-blue-400 ml-1 text-xs">(我)</span>}
                  </div>
                </div>
                {player.id === room.hostId && (
                  <span className="text-[0.65rem] bg-gold/80 text-black font-bold px-2 py-0.5 rounded">房主</span>
                )}
                <span className="font-display text-gold text-sm">{formatChips(room.settings.startingChips)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Settings (host only) */}
        {isHost && (
          <div className="mb-6 bg-black/20 rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-3">游戏设置</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 block mb-1">初始筹码</label>
                <div className="text-white/70 text-sm">{formatChips(room.settings.startingChips)}</div>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">盲注</label>
                <div className="text-white/70 text-sm">{room.settings.smallBlind}/{room.settings.bigBlind}</div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          {isHost && (
            <>
              <button
                onClick={onStart}
                disabled={room.players.length < 2}
                className={clsx(
                  'w-full py-3.5 rounded-xl font-display text-2xl tracking-widest transition-all',
                  room.players.length >= 2
                    ? 'bg-gradient-to-r from-gold-dark to-gold text-black hover:brightness-110 active:scale-95'
                    : 'bg-white/5 text-white/20 cursor-not-allowed'
                )}
              >
                开始游戏
              </button>
              <button
                onClick={onAddBot}
                disabled={room.players.length >= room.settings.maxPlayers}
                className="w-full py-2.5 rounded-xl border border-white/10 text-white/60 hover:bg-white/5 hover:text-white transition-all font-medium text-sm"
              >
                ➕ 添加机器人
              </button>
            </>
          )}

          {!isHost && (
            <div className="text-center text-white/40 text-sm py-2 bg-black/20 rounded-xl border border-white/5">
              ⏳ 等待房主开始游戏...
            </div>
          )}

          <button
            onClick={onLeave}
            className="w-full py-2 text-white/30 hover:text-white/60 text-sm transition-colors"
          >
            离开房间
          </button>
        </div>
      </div>
    </div>
  );
}
