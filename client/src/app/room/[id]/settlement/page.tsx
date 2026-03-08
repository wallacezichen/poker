'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';

interface LedgerRow {
  id: string;
  name: string;
  buyIn: number;
  buyOut: number;
  net: number;
}

function formatChips(n: number): string {
  return String(n);
}

export default function SettlementPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = String(params?.id || '').toUpperCase();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [gameType, setGameType] = useState<string>('short_deck');

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(`ledger:${roomId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const nextRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      setRows(nextRows);
      setGameType(String(parsed?.gameType || 'short_deck'));
    } catch {
      // ignore
    }
  }, [roomId]);

  const modeLabel = gameType === 'regular'
    ? "Texas Poker Hold'em"
    : gameType === 'omaha'
      ? 'Omaha'
      : gameType === 'crazy_pineapple'
        ? 'Crazy Pineapple'
        : 'Short Deck';

  return (
    <div
      className="relative min-h-screen flex items-center justify-center p-4 text-white"
      style={{ background: 'radial-gradient(circle at 50% 10%, #2b2f3a 0%, #1a1d26 45%, #12141b 100%)' }}
    >
      <button
        onClick={() => router.push('/')}
        className="absolute left-4 top-4 px-5 py-2 rounded-lg border border-emerald-300/40 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-100 font-semibold"
      >
        Create New Room
      </button>
      <div className="w-[860px] max-w-[96vw] rounded-xl border border-white/20 bg-[#141821] p-5 shadow-[0_20px_45px_rgba(0,0,0,0.5)]">
        <div className="text-center">
          <div className="text-2xl font-bold">Session Ledger</div>
          <div className="mt-1 text-white/70 text-sm">Room {roomId} · {modeLabel}</div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-white/70 border-b border-white/15">
                <th className="text-left py-2 pr-3">Player</th>
                <th className="text-right py-2 pr-3">Buy-in</th>
                <th className="text-right py-2 pr-3">Buy-out</th>
                <th className="text-right py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-white/10">
                  <td className="py-2 pr-3">{row.name}</td>
                  <td className="py-2 pr-3 text-right">{formatChips(row.buyIn)}</td>
                  <td className="py-2 pr-3 text-right">{formatChips(row.buyOut)}</td>
                  <td className={clsx('py-2 text-right font-semibold', row.net >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {row.net >= 0 ? '+' : ''}{formatChips(row.net)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-white/60">No ledger data found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
