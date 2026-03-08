'use client';
import { Card as CardType } from '../types/poker';
import clsx from 'clsx';

interface CardProps {
  card?: CardType;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  index?: number; // for staggered animation
}

const sizeClasses = {
  sm: 'w-9 h-[52px]',
  md: 'w-[52px] h-[76px]',
  lg: 'w-[64px] h-[92px]',
};

const rankSize = {
  sm: 'text-3xl',
  md: 'text-4xl',
  lg: 'text-5xl',
};

const rankBox = {
  sm: 'w-6',
  md: 'w-7',
  lg: 'w-8',
};

const suitSize = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-3xl',
};

export default function Card({ card, faceDown = false, size = 'md', className = '', index = 0 }: CardProps) {
  const isRed = card && (card.suit === '♥' || card.suit === '♦');
  const rankLabel = card?.rank === 'T' ? '10' : card?.rank;

  if (faceDown || !card) {
    return (
      <div
        className={clsx(
          sizeClasses[size],
          'relative rounded-md flex items-center justify-center flex-shrink-0 select-none',
          'shadow-card card-deal',
          faceDown
            ? 'bg-gradient-to-br from-blue-800 to-blue-900 border-2 border-white/20'
            : 'bg-white/5 border-2 border-dashed border-white/20',
          className
        )}
        style={{ animationDelay: `${index * 80}ms` }}
      >
        {faceDown && (
          <div className="w-3/4 h-3/4 border border-white/20 rounded-sm" />
        )}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        sizeClasses[size],
        'relative rounded-xl bg-[#f6f6f6] border border-white/80 flex-shrink-0 select-none',
        'shadow-card hover:-translate-y-1 transition-transform overflow-hidden',
        'cursor-default card-deal',
        isRed ? 'card-red' : 'card-black',
        className
      )}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <span
        className={clsx(
          rankSize[size],
          rankBox[size],
          'absolute top-1.5 left-1.5 font-extrabold leading-none text-center tabular-nums',
          rankLabel === '10' && 'tracking-tight'
        )}
      >
        {rankLabel}
      </span>
      <span className={clsx(suitSize[size], 'absolute bottom-1.5 right-0.5 leading-none')}>{card.suit}</span>
    </div>
  );
}
