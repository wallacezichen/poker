'use client';

type SfxKey = 'deal' | 'bet' | 'reveal' | 'tap' | 'winner';

const SFX: Record<SfxKey, { src: string; volume: number }> = {
  deal: { src: '/sfx/card-flip.mp3', volume: 0.4 },
  bet: { src: '/sfx/chip.mp3', volume: 0.45 },
  reveal: { src: '/sfx/card-flip.mp3', volume: 0.56 },
  tap: { src: '/sfx/tap.mp3', volume: 0.34 },
  winner: { src: '/sfx/winner.mp3', volume: 0.5 },
};

let soundMuted = false;
let masterVolume = 0.8; // 0..1

export function setSoundSettings(next: { muted?: boolean; volume?: number }): void {
  if (typeof next.muted === 'boolean') soundMuted = next.muted;
  if (typeof next.volume === 'number') {
    masterVolume = Math.max(0, Math.min(1, next.volume));
  }
}

export function getSoundSettings(): { muted: boolean; volume: number } {
  return { muted: soundMuted, volume: masterVolume };
}

function playSfx(key: SfxKey): void {
  if (typeof window === 'undefined') return;
  if (soundMuted) return;
  const cfg = SFX[key];
  try {
    const audio = new Audio(cfg.src);
    audio.volume = Math.max(0, Math.min(1, cfg.volume * masterVolume));
    audio.preload = 'auto';
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // ignore blocked autoplay / permission errors
      });
    }
  } catch {
    // ignore play errors (autoplay policy, etc.)
  }
}

export function playHoleCardsSound(): void {
  playSfx('deal');
}

export function playFlopSound(): void {
  playSfx('reveal');
}

export function playTurnSound(): void {
  playSfx('reveal');
}

export function playRiverSound(): void {
  playSfx('reveal');
}

export function playBetSound(): void {
  playSfx('bet');
}

export function playCheckSound(): void {
  playSfx('tap');
}

export function playWinnerSound(): void {
  playSfx('winner');
}
