'use client';
import { Card as CardType, PlayerState, Rank } from '../types/poker';
import Card from './Card';
import clsx from 'clsx';

interface PlayerSeatProps {
  player: PlayerState;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isActive: boolean;
  isMe: boolean;
  isShowdown: boolean;
  isWinner?: boolean;
  communityCards?: CardType[];
  winsCount?: number;
  statusText?: string;
  showCheckBubble?: boolean;
}

function formatChips(n: number): string {
  return String(n);
}

export default function PlayerSeat({
  player, isDealer, isSmallBlind, isBigBlind,
  isActive, isMe, isShowdown, isWinner = false, communityCards = [], winsCount = 0, statusText, showCheckBubble = false,
}: PlayerSeatProps) {
  const showCards = isMe || (player.holeCards?.length ?? 0) > 0;
  const mask = player.revealedMask ?? 0;
  let displayCards: Array<CardType | undefined>;
  if (isMe) {
    displayCards = [player.holeCards?.[0], player.holeCards?.[1]];
  } else if (mask === 1) {
    displayCards = [player.holeCards?.[0], undefined];
  } else if (mask === 2) {
    displayCards = [undefined, player.holeCards?.[0]];
  } else if (mask === 3) {
    displayCards = [player.holeCards?.[0], player.holeCards?.[1]];
  } else {
    displayCards = [undefined, undefined];
  }
  const liveBest = isMe ? evaluateBestHandName([...player.holeCards, ...communityCards]) : '';
  const handLabel = player.handResult?.name?.toUpperCase() || player.handResult?.nameZh || liveBest;

  return (
    <div className={clsx('relative select-none', player.folded && 'opacity-45')}>
      <div className="flex items-end gap-2">
        <div className="flex -space-x-2 mb-1">
          {displayCards.map((card, i) => (
            <Card
              key={i}
              card={card}
              faceDown={!showCards || !card}
              size="lg"
              index={i}
              className={clsx('rotate-[-4deg]', i === 1 && 'rotate-[5deg]')}
            />
          ))}
        </div>

        <div
          className={clsx(
            'relative min-w-[190px] rounded-xl border px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all',
            'bg-slate-600 border-white/35',
            isActive && !player.folded && 'ring-4 ring-yellow-300 border-yellow-200 shadow-[0_0_30px_rgba(250,204,21,0.72)]',
            isWinner && 'ring-2 ring-yellow-300 shadow-[0_0_28px_rgba(250,204,21,0.62)]'
          )}
        >
          {player.folded && (
            <div className="pointer-events-none absolute inset-0 rounded-xl flex items-center justify-center bg-black/25">
              <span className="text-red-500/95 text-7xl font-black leading-none drop-shadow-[0_0_10px_rgba(239,68,68,0.65)]">
                X
              </span>
            </div>
          )}
          {isWinner && (
            <>
              <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-yellow-300/18 via-amber-200/8 to-transparent" />
              <div className="pointer-events-none absolute -inset-0.5 rounded-[14px] border border-yellow-200/45" />
            </>
          )}

          <div className="text-[1.6rem] font-bold leading-tight max-w-[130px] truncate text-white">{player.name}</div>
          <div className="text-[1.3rem] font-bold leading-tight mt-0.5 text-white">{formatChips(player.chips)}</div>

          <div className={clsx(
            'absolute top-1 bg-emerald-500 text-white rounded-full px-2.5 py-0.5 text-[0.95rem] font-bold flex items-center gap-1',
            isWinner ? 'right-14' : 'right-2'
          )}>
            <span>🏆</span>
            <span>{winsCount}</span>
          </div>
          {isWinner && (
            <img
              src="/winner-homer.webp"
              alt="winner"
              className="absolute -top-2 right-1 w-12 h-12 object-cover rounded-md border border-yellow-200/65 shadow-[0_6px_16px_rgba(250,204,21,0.45)]"
            />
          )}

          {(isSmallBlind || isBigBlind) && (
            <div className="absolute -top-4 -left-4 flex gap-1">
              {isSmallBlind && (
                <span className="bg-blue-100 text-blue-700 text-[11px] font-bold rounded-full w-7 h-7 flex items-center justify-center shadow">SB</span>
              )}
              {isBigBlind && (
                <span className="bg-yellow-200 text-yellow-900 text-[11px] font-bold rounded-full w-7 h-7 flex items-center justify-center shadow">BB</span>
              )}
            </div>
          )}

          {player.bet > 0 && (
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-lime-300 text-black rounded-full w-12 h-12 text-xl font-bold flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
              {formatChips(player.bet)}
            </div>
          )}
          {player.bet === 0 && showCheckBubble && (
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-sky-200 text-sky-900 rounded-full px-3 h-11 text-xs font-extrabold tracking-wide flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
              Check
            </div>
          )}
          {player.allIn && <div className="text-sm text-rose-500 font-bold mt-1">ALL-IN</div>}
          {!player.isConnected && <div className="text-sm text-rose-500 font-bold mt-1">DISCONNECTED</div>}
        </div>
      </div>

      {handLabel && !player.folded && (
        <div className="mt-1 text-center text-[0.95rem] font-semibold text-amber-200 tracking-wide">
          {handLabel}
        </div>
      )}
      {statusText && (
        <div className="mt-1 text-center text-[0.9rem] font-semibold text-sky-200 tracking-wide">
          {statusText}
        </div>
      )}

    </div>
  );
}

function evaluateBestHandName(cards: CardType[]): string {
  if (cards.length < 5) return '';
  let bestRank = -1;
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5Rank(combo);
    if (r > bestRank) bestRank = r;
  }
  return HAND_NAMES[bestRank] || '';
}

const RANK_VALUES: Record<Rank, number> = {
  '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

const HAND_NAMES: Record<number, string> = {
  9: 'ROYAL FLUSH',
  8: 'STRAIGHT FLUSH',
  7: 'FOUR OF A KIND',
  6: 'FLUSH',
  5: 'FULL HOUSE',
  4: 'STRAIGHT',
  3: 'THREE OF A KIND',
  2: 'TWO PAIR',
  1: 'ONE PAIR',
  0: 'HIGH CARD',
};

function evaluate5Rank(cards: CardType[]): number {
  const values = cards.map(c => RANK_VALUES[c.rank]);
  const suits = cards.map(c => c.suit);
  const counts = new Map<number, number>();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  const freq = Array.from(counts.values()).sort((a, b) => b - a);
  const isFlush = new Set(suits).size === 1;
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  const isWheel = [6, 7, 8, 9, 14].every(v => unique.includes(v));
  let isStraight = isWheel;
  let high = isWheel ? 9 : 0;
  if (!isStraight) {
    for (let i = unique.length - 1; i >= 4; i--) {
      const top = unique[i];
      if ([1, 2, 3, 4].every(d => unique.includes(top - d))) {
        isStraight = true;
        high = top;
        break;
      }
    }
  }
  if (isFlush && isStraight) return high === 14 ? 9 : 8;
  if (freq[0] === 4) return 7;
  if (isFlush) return 6;
  if (freq[0] === 3 && freq[1] === 2) return 5;
  if (freq[0] === 3) return 3;
  if (isStraight) return 4;
  if (freq[0] === 2 && freq[1] === 2) return 2;
  if (freq[0] === 2) return 1;
  return 0;
}

function combinations(arr: CardType[], k: number): CardType[][] {
  if (k === arr.length) return [arr];
  if (k === 1) return arr.map(x => [x]);
  const out: CardType[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combinations(arr.slice(i + 1), k - 1)) {
      out.push([arr[i], ...tail]);
    }
  }
  return out;
}
