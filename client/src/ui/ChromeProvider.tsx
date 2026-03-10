'use client';
import React, { createContext, useContext, useMemo, useState } from 'react';

type ChromeContextValue = {
  inGame: boolean;
  setInGame: (v: boolean) => void;
};

const ChromeContext = createContext<ChromeContextValue | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [inGame, setInGame] = useState(false);
  const value = useMemo(() => ({ inGame, setInGame }), [inGame]);
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeContextValue {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error('useChrome must be used within ChromeProvider');
  return ctx;
}

