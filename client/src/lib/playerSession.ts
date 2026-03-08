'use client';

type SavedIdentity = {
  playerId: string;
  playerName?: string;
  savedAt: string;
};

const KEY = 'shortdeck:room-identities:v1';

function readAll(): Record<string, SavedIdentity> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, SavedIdentity>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ignore localStorage errors
  }
}

export function saveRoomIdentity(roomId: string, playerId: string, playerName?: string): void {
  const key = roomId.toUpperCase();
  const all = readAll();
  all[key] = { playerId, playerName, savedAt: new Date().toISOString() };
  writeAll(all);
}

export function getRoomIdentity(roomId: string): SavedIdentity | null {
  const all = readAll();
  return all[roomId.toUpperCase()] ?? null;
}

export function clearRoomIdentity(roomId: string): void {
  const key = roomId.toUpperCase();
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  writeAll(all);
}

