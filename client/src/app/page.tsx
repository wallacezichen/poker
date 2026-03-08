'use client';
import { Suspense } from 'react';
import LobbyPage from './_lobby';

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gold font-display text-2xl">加载中...</div>}>
      <LobbyPage />
    </Suspense>
  );
}
