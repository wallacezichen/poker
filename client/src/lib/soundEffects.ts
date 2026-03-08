'use client';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function playTone(freq: number, durationMs: number, type: OscillatorType, gain = 0.04, delayMs = 0): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const start = ctx.currentTime + delayMs / 1000;
  const end = start + durationMs / 1000;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);

  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(end);
}

export function playHoleCardsSound(): void {
  playTone(620, 55, 'triangle', 0.05, 0);
  playTone(740, 60, 'triangle', 0.05, 70);
}

export function playFlopSound(): void {
  playTone(420, 60, 'sine', 0.045, 0);
  playTone(520, 60, 'sine', 0.045, 70);
  playTone(640, 70, 'sine', 0.05, 140);
}

export function playTurnSound(): void {
  playTone(520, 70, 'triangle', 0.05, 0);
  playTone(700, 80, 'triangle', 0.05, 90);
}

export function playRiverSound(): void {
  playTone(360, 70, 'sine', 0.05, 0);
  playTone(480, 70, 'sine', 0.05, 90);
  playTone(720, 120, 'triangle', 0.055, 180);
}

export function playBetSound(): void {
  // Softer coin-like tick (less harsh than square wave)
  playTone(760, 26, 'triangle', 0.026, 0);
  playTone(1080, 34, 'sine', 0.02, 24);
}
