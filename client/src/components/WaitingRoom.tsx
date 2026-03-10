'use client';
import { useState } from 'react';
import { Room } from '../types/poker';
import clsx from 'clsx';
import { useI18n } from '../i18n/LanguageProvider';

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
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isHost = room.hostId === myPlayerId;
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/room/${room.id}?g=${encodeURIComponent(room.settings.gameType || 'short_deck')}`
    : `/room/${room.id}`;

  function copyLink() {
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const normalizedGameType = room.settings.gameType === 'regular' || room.settings.gameType === 'short_deck' || room.settings.gameType === 'omaha' || room.settings.gameType === 'crazy_pineapple'
    ? room.settings.gameType
    : 'short_deck';
  const gameLabel = normalizedGameType === 'short_deck'
    ? t('game.short_deck.pill')
    : normalizedGameType === 'regular'
      ? t('game.regular.pill')
      : normalizedGameType === 'omaha'
        ? t('game.omaha.pill')
        : t('game.crazy_pineapple.title');
  const waitingBg = normalizedGameType === 'short_deck'
    ? 'radial-gradient(ellipse at center, #1a4a2e 0%, #0a1f12 100%)'
    : normalizedGameType === 'regular'
      ? 'radial-gradient(ellipse at center, #132651 0%, #070c1a 100%)'
      : normalizedGameType === 'omaha'
        ? 'radial-gradient(ellipse at center, #4f2a11 0%, #140903 100%)'
        : 'radial-gradient(ellipse at center, #3f0f2f 0%, #14060f 100%)';
  const panelClass = normalizedGameType === 'short_deck'
    ? 'bg-white/5 border border-gold/20'
    : normalizedGameType === 'regular'
      ? 'bg-sky-950/25 border border-sky-300/30'
      : normalizedGameType === 'omaha'
        ? 'bg-amber-950/20 border border-amber-200/30'
        : 'bg-fuchsia-950/20 border border-fuchsia-200/30';
  const badgeClass = normalizedGameType === 'short_deck'
    ? 'bg-gradient-to-r from-gold-dark to-gold text-black'
    : normalizedGameType === 'regular'
      ? 'bg-gradient-to-r from-sky-200 to-cyan-100 text-sky-900'
      : normalizedGameType === 'omaha'
        ? 'bg-gradient-to-r from-amber-200 to-yellow-100 text-amber-900'
        : 'bg-gradient-to-r from-fuchsia-200 to-pink-100 text-fuchsia-900';

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: waitingBg }}
    >
      <div className={clsx('w-full max-w-lg rounded-2xl p-8 backdrop-blur-sm', panelClass)}>
        {/* Header */}
        <div className="text-center mb-6">
          <span className={clsx('inline-block text-xs font-bold px-3 py-1 rounded-full mb-3', badgeClass)}>
            {gameLabel}
          </span>
          <h1 className="font-display text-4xl text-gold tracking-widest">{t('waiting.title')}</h1>
        </div>

        {/* Room code */}
        <div className="text-center mb-4">
          <div className="text-xs text-white/40 uppercase tracking-widest mb-1">{t('waiting.room_code')}</div>
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
          {copied ? t('waiting.link_copied') : shareLink}
        </div>
        <p className="text-[0.7rem] text-white/30 text-center mb-6">{t('common.copy_link')}</p>

        {/* Players */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/40 uppercase tracking-widest">{t('waiting.players')}</span>
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
                    {player.id === myPlayerId && <span className="text-blue-400 ml-1 text-xs">{t('waiting.me')}</span>}
                  </div>
                </div>
                {player.id === room.hostId && (
                  <span className="text-[0.65rem] bg-gold/80 text-black font-bold px-2 py-0.5 rounded">{t('waiting.host')}</span>
                )}
                <span className="font-display text-gold text-sm">{formatChips(room.settings.startingChips)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Settings (host only) */}
        {isHost && (
          <div className="mb-6 bg-black/20 rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40 uppercase tracking-widest mb-3">{t('waiting.settings')}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 block mb-1">{t('waiting.starting_chips')}</label>
                <div className="text-white/70 text-sm">{formatChips(room.settings.startingChips)}</div>
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1">{t('waiting.blinds')}</label>
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
                {t('waiting.start_game')}
              </button>
              <button
                onClick={onAddBot}
                disabled={room.players.length >= room.settings.maxPlayers}
                className="w-full py-2.5 rounded-xl border border-white/10 text-white/60 hover:bg-white/5 hover:text-white transition-all font-medium text-sm"
              >
                {t('waiting.add_bot')}
              </button>
            </>
          )}

          {!isHost && (
            <div className="text-center text-white/40 text-sm py-2 bg-black/20 rounded-xl border border-white/5">
              {t('waiting.wait_host')}
            </div>
          )}

          <button
            onClick={onLeave}
            className="w-full py-2 text-white/30 hover:text-white/60 text-sm transition-colors"
          >
            {t('common.leave_room')}
          </button>
        </div>
      </div>
    </div>
  );
}
