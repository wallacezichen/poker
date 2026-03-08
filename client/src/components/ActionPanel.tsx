'use client';
import { useState, useCallback } from 'react';
import { GameState, ActionType, PlayerState } from '../types/poker';
import clsx from 'clsx';

interface ActionPanelProps {
  gameState: GameState;
  myPlayer: PlayerState;
  onAction: (action: ActionType, amount?: number) => void;
  timerSeconds: number;
}

function formatChips(n: number): string {
  return String(n);
}

export default function ActionPanel({ gameState, myPlayer, onAction, timerSeconds }: ActionPanelProps) {
  const [raiseAmount, setRaiseAmount] = useState<number>(0);

  const canCheck = gameState.currentBet <= myPlayer.bet;
  const callAmt = Math.min(gameState.currentBet - myPlayer.bet, myPlayer.chips);
  const minRaiseTo = gameState.currentBet + (gameState.lastRaiseSize ?? gameState.bigBlind);
  const minRaise = Math.min(minRaiseTo, myPlayer.chips + myPlayer.bet);
  const maxRaise = myPlayer.chips + myPlayer.bet;
  const canRaise = maxRaise >= minRaiseTo && myPlayer.chips > callAmt;

  // Initialize raise amount with a big-blind-based default
  const bbDefault = gameState.currentBet + gameState.bigBlind;
  const effectiveRaise = raiseAmount || Math.min(Math.max(minRaise, bbDefault), maxRaise);

  const handleRaiseChange = useCallback((val: number) => {
    setRaiseAmount(Math.min(Math.max(val, minRaise), maxRaise));
  }, [minRaise, maxRaise]);

  const isAllIn = myPlayer.chips === 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Timer bar */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/55">Time</span>
        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{
              width: `${(timerSeconds / 30) * 100}%`,
              background: timerSeconds > 20 ? '#d4a847' : timerSeconds > 10 ? '#f39c12' : '#e74c3c',
            }}
          />
        </div>
        <span
          className={clsx(
            'text-xs font-display tracking-wide min-w-[28px] text-right',
            timerSeconds <= 10 ? 'text-red-400' : 'text-white/80'
          )}
        >
          {timerSeconds}s
        </span>
      </div>

      {/* Action buttons row */}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {/* Fold */}
        <button
          onClick={() => onAction('fold')}
          className={clsx(
            'px-4 py-2 rounded-md text-sm border transition-all',
            'bg-black/40 text-red-300 border-white/20 hover:bg-black/60 hover:border-white/40',
            'active:scale-95'
          )}
        >
          弃牌
        </button>

        {/* Check or Call */}
        {canCheck ? (
          <button
            onClick={() => onAction('check')}
            className={clsx(
              'px-4 py-2 rounded-md text-sm border transition-all',
              'bg-black/40 text-sky-200 border-white/20 hover:bg-black/60 hover:border-white/40',
              'active:scale-95'
            )}
          >
            过牌
          </button>
        ) : (
          <button
            onClick={() => onAction('call')}
            className={clsx(
              'px-4 py-2 rounded-md text-sm border transition-all',
              'bg-black/40 text-emerald-200 border-white/20 hover:bg-black/60 hover:border-white/40',
              'active:scale-95'
            )}
          >
            跟注 {formatChips(callAmt)}
          </button>
        )}

        {/* Raise section */}
        {canRaise && (
          <div className="flex items-center gap-2 bg-black/30 rounded-lg p-2 border border-white/20">
            <div className="flex flex-col gap-1">
              <input
                type="range"
                min={minRaise}
                max={maxRaise}
                step={gameState.bigBlind}
                value={effectiveRaise}
                onChange={(e) => handleRaiseChange(parseInt(e.target.value))}
                className="w-24 md:w-32 accent-gold"
              />
              <div className="flex justify-between text-[0.6rem] text-white/30">
                <span>{formatChips(minRaise)}</span>
                <span>{formatChips(maxRaise)}</span>
              </div>
            </div>

            <input
              type="number"
              min={minRaise}
              max={maxRaise}
              step={gameState.bigBlind}
              value={Math.round(effectiveRaise)}
              onChange={(e) => handleRaiseChange(parseInt(e.target.value))}
              className={clsx(
                'w-20 bg-black/45 border border-white/30 rounded-md px-2 py-1',
                'text-white text-sm tracking-wide text-center outline-none',
                'focus:border-white/70'
              )}
            />

            {/* Preset buttons */}
            <div className="flex flex-col gap-1">
              {[
                { label: '1/2锅', val: Math.floor(gameState.pot / 2) },
                { label: '全锅', val: gameState.pot },
              ].map(({ label, val }) => {
                const clamped = Math.min(Math.max(val, minRaise), maxRaise);
                return (
                  <button
                    key={label}
                    onClick={() => handleRaiseChange(clamped)}
                    className="text-[0.6rem] bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded px-2 py-0.5 transition-colors"
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => onAction('raise', Math.round(effectiveRaise))}
              className={clsx(
                'px-3 py-2 rounded-md text-sm border transition-all',
                'bg-black/40 text-amber-200 border-white/20 hover:bg-black/60 hover:border-white/40',
                'active:scale-95'
              )}
            >
              加注
            </button>
          </div>
        )}

        {/* All-in */}
        <button
          onClick={() => onAction('allin')}
          className={clsx(
            'px-4 py-2 rounded-md text-sm border transition-all',
            'bg-black/40 text-rose-200 border-white/20 hover:bg-black/60 hover:border-white/40',
            'active:scale-95'
          )}
        >
          全押 {formatChips(myPlayer.chips)}
        </button>
      </div>
    </div>
  );
}
