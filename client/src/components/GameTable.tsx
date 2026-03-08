'use client';
import { useEffect, useRef, useState } from 'react';
import { GameState, Room, JoinRequest } from '../types/poker';
import Card from './Card';
import PlayerSeat from './PlayerSeat';
import { useGameStore } from '../store/gameStore';
import clsx from 'clsx';
import { getSoundSettings, setSoundSettings } from '../lib/soundEffects';

// Seat positions as percentage [top, left] on the oval table
// Position 0 = bottom center (always my seat), others go clockwise
const SEAT_POSITIONS: Array<{ top: string; left: string }> = [
  { top: '88%', left: '50%' },   // 0 - bottom center (me)
  { top: '75%', left: '12%' },   // 1 - bottom left
  { top: '40%', left: '2%' },    // 2 - left
  { top: '8%', left: '14%' },    // 3 - top left
  { top: '3%',  left: '50%' },   // 4 - top center
  { top: '8%', left: '86%' },    // 5 - top right
  { top: '40%', left: '98%' },   // 6 - right
  { top: '75%', left: '88%' },   // 7 - bottom right
  { top: '50%', left: '50%' },   // 8 - center (overflow)
];

function formatChips(n: number): string {
  return String(n);
}

function cardShortLabel(card?: { rank: string; suit: string }): string {
  if (!card) return '??';
  const rank = card.rank === 'T' ? '10' : card.rank;
  return `${rank}${card.suit}`;
}

function valueToRank(v: number): string {
  if (v === 14) return 'A';
  if (v === 13) return 'K';
  if (v === 12) return 'Q';
  if (v === 11) return 'J';
  if (v === 10) return '10';
  return String(v);
}

function rankWord(v: number): string {
  const r = valueToRank(v);
  if (r === 'A') return 'Aces';
  if (r === 'K') return 'Kings';
  if (r === 'Q') return 'Queens';
  if (r === 'J') return 'Jacks';
  if (r === '10') return 'Tens';
  return `${r}s`;
}

function formatHandLabelEnDetailed(result?: { rank: number; name: string; tiebreak: number[] }): string {
  if (!result) return '';
  if (result.rank >= 4) return result.name;
  if (result.rank === 3) {
    const trip = Math.floor((result.tiebreak[0] || 0) / 100);
    return `Set of ${rankWord(trip)}`;
  }
  if (result.rank === 2) {
    const p1 = Math.floor((result.tiebreak[0] || 0) / 100);
    const p2 = Math.floor((result.tiebreak[1] || 0) / 100);
    return `Two Pair(${rankWord(p1)}, ${rankWord(p2)})`;
  }
  if (result.rank === 1) {
    const p = Math.floor((result.tiebreak[0] || 0) / 100);
    return `One Pair(${rankWord(p)})`;
  }
  const hi = result.tiebreak[0] || 0;
  return `${valueToRank(hi)}-high`;
}

function communityCountForStage(stage?: GameState['stage']): number {
  if (stage === 'flop') return 3;
  if (stage === 'turn') return 4;
  if (stage === 'river' || stage === 'showdown') return 5;
  return 0;
}

interface GameTableProps {
  gameState: GameState;
  room: Room;
  myPlayerId: string;
  onAction: (action: any, amount?: number) => void;
  onSendChat: (msg: string) => void;
  onSetAway: (away: boolean) => void;
  onJoinRequestDecision: (requestId: string, approve: boolean, buyIn?: number) => void;
  onHostManagePlayer: (targetPlayerId: string, action: 'set_chips' | 'kick', chips?: number) => Promise<{ success: boolean; error?: string }>;
  onSetPause: (paused: boolean) => void;
  onNextHand: () => void;
  onRevealCards: (count: 1 | 2) => void;
  onRunItTwiceVote: (agree: boolean) => void;
  onLeave: () => void;
}

export default function GameTable({
  gameState, room, myPlayerId,
  onAction, onSendChat, onSetAway, onJoinRequestDecision, onHostManagePlayer, onSetPause, onNextHand, onRevealCards, onRunItTwiceVote, onLeave
}: GameTableProps) {
  const {
    chatMessages, joinRequests,
    handResult, showHandResult, setShowHandResult, setHandResult, isGamePaused,
  } = useGameStore();

  const [raiseAmount, setRaiseAmount] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [winsByPlayer, setWinsByPlayer] = useState<Record<string, number>>({});
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [uiScale, setUiScale] = useState(1);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showSoundPanel, setShowSoundPanel] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const [soundVolume, setSoundVolume] = useState(80);
  const [manageTargetId, setManageTargetId] = useState<string | null>(null);
  const [manageChips, setManageChips] = useState<string>('');
  const [managing, setManaging] = useState(false);
  const [checkBubblePlayers, setCheckBubblePlayers] = useState<Set<string>>(new Set());
  const prevStageRef = useRef(gameState.stage);
  const prevHandRef = useRef(gameState.handNumber);
  const prevActionLenRef = useRef(gameState.actionLog.length);

  // Find my player
  const myPlayer = gameState.players.find(p => p.id === myPlayerId);
  const isMyTurn = gameState.players[gameState.currentPlayerIndex]?.id === myPlayerId;
  const canAct = isMyTurn && !myPlayer?.folded && !myPlayer?.allIn && gameState.stage !== 'showdown' && !isGamePaused;

  // Reorder players so my seat is at position 0
  const inHandById = new Map(gameState.players.map((p, idx) => [p.id, { player: p, idx }]));
  const roomPlayersSorted = [...room.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const myRoomIdx = roomPlayersSorted.findIndex(p => p.id === myPlayerId);
  const roomStartIdx = myRoomIdx >= 0 ? myRoomIdx : 0;
  const orderedRoomPlayers = roomPlayersSorted
    .map((_, i) => roomPlayersSorted[(roomStartIdx + i) % roomPlayersSorted.length])
    .filter((p): p is (typeof roomPlayersSorted)[number] => !!p);

  const callAmt = myPlayer ? Math.min(gameState.currentBet - myPlayer.bet, myPlayer.chips) : 0;
  const canCheck = myPlayer ? gameState.currentBet <= myPlayer.bet : false;
  const minRaiseTo = gameState.currentBet + (gameState.lastRaiseSize ?? gameState.bigBlind);
  const minRaise = myPlayer ? Math.min(minRaiseTo, myPlayer.chips + myPlayer.bet) : 0;
  const safeRaise = Math.max(raiseAmount || minRaise, minRaise);
  const canRaise = !!myPlayer && (myPlayer.chips + myPlayer.bet) >= minRaiseTo && myPlayer.chips > callAmt;
  const maxTotalBet = myPlayer ? myPlayer.chips + myPlayer.bet : 0;
  const canQuickBet = callAmt <= 0 && gameState.currentBet === 0 && canRaise;
  const showPrimaryAction = callAmt > 0 || canQuickBet;
  const potAfterCall = gameState.pot + callAmt;
  const presetRaiseTo = (fraction: number) =>
    Math.floor(gameState.currentBet + potAfterCall * fraction);
  const recentChat = chatMessages.slice(-3);
  const ownerName = room.players.find(p => p.id === room.hostId)?.name || 'HOST';
  const meInRoom = room.players.find(p => p.id === myPlayerId);
  const isAway = !!meInRoom?.isAway;
  const winnerIds = new Set(
    ((showHandResult ? handResult?.winners : undefined)?.map(w => w.playerId) ||
      gameState.winners?.map(w => w.playerId) || [])
  );
  const isHost = room.hostId === myPlayerId;
  const manageTarget = manageTargetId ? room.players.find((p) => p.id === manageTargetId) : undefined;
  const myRevealMask = myPlayer?.revealedMask ?? 0;
  const runItTwice = gameState.runItTwice;
  const myRunItTwiceVote = runItTwice?.votes?.[myPlayerId] ?? null;
  const showRunItTwicePanel = runItTwice?.status === 'pending' && myPlayerId in (runItTwice?.votes || {});
  const showdownPlayers = gameState.players.filter((p) => !p.folded && !!p.handResult);
  const showBothRunBoards =
    runItTwice?.status === 'agreed' &&
    (runItTwice.phase === 'run2' || runItTwice.phase === 'run2_showdown' || runItTwice.phase === 'final') &&
    !!runItTwice.boards?.[0];
  const sharedStreetCount = communityCountForStage(runItTwice?.baseStage);
  const visibleStreetCount = communityCountForStage(gameState.stage);
  const newStreetIndices = Array.from(
    { length: Math.max(0, visibleStreetCount - sharedStreetCount) },
    (_, idx) => sharedStreetCount + idx
  );
  const showPreflopRunGrid = showBothRunBoards && sharedStreetCount === 0;
  const showFlopRunGrid = showBothRunBoards && sharedStreetCount === 3;
  const showTurnRunGrid = showBothRunBoards && sharedStreetCount === 4;

  useEffect(() => {
    if (!handResult?.winners?.length) return;
    setWinsByPlayer((prev) => {
      const next = { ...prev };
      for (const w of handResult.winners) {
        next[w.playerId] = (next[w.playerId] || 0) + 1;
      }
      return next;
    });
  }, [handResult?.handNumber]);

  useEffect(() => {
    if (!canAct || !canRaise) setShowRaisePanel(false);
  }, [canAct, canRaise, gameState.stage, gameState.handNumber]);

  useEffect(() => {
    const stageChanged = prevStageRef.current !== gameState.stage;
    const handChanged = prevHandRef.current !== gameState.handNumber;

    // Round ended (or new hand): clear all action bubbles immediately.
    if (stageChanged || handChanged) {
      setCheckBubblePlayers(new Set());
      prevStageRef.current = gameState.stage;
      prevHandRef.current = gameState.handNumber;
      prevActionLenRef.current = gameState.actionLog.length;
      return;
    }

    const prevLen = prevActionLenRef.current;
    if (gameState.actionLog.length > prevLen) {
      const newEntries = gameState.actionLog.slice(prevLen);
      setCheckBubblePlayers((prev) => {
        const next = new Set(prev);
        for (const entry of newEntries) {
          if (entry.action === 'check') next.add(entry.playerId);
          else next.delete(entry.playerId);
        }
        return next;
      });
    }

    prevStageRef.current = gameState.stage;
    prevHandRef.current = gameState.handNumber;
    prevActionLenRef.current = gameState.actionLog.length;
  }, [gameState.stage, gameState.handNumber, gameState.actionLog]);

  useEffect(() => {
    if (!manageTargetId) return;
    const target = room.players.find(p => p.id === manageTargetId);
    if (!target) {
      setManageTargetId(null);
      setManageChips('');
      return;
    }
    setManageChips(String(target.chips));
  }, [manageTargetId, room.players]);

  useEffect(() => {
    function updateScale() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const headerH = 44;
      const availH = Math.max(320, h - headerH);

      // Baseline designed around ~1600x900 game viewport.
      const scaleW = w / 1600;
      const scaleH = availH / 860;
      const next = Math.max(0.62, Math.min(1, Math.min(scaleW, scaleH)));
      setUiScale(next);
    }

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('shortdeck:sound-settings:v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        const muted = !!parsed?.muted;
        const vol = Math.max(0, Math.min(100, Number(parsed?.volume ?? 80)));
        setSoundMuted(muted);
        setSoundVolume(vol);
        setSoundSettings({ muted, volume: vol / 100 });
        return;
      }
    } catch {
      // ignore parse errors
    }
    const current = getSoundSettings();
    setSoundMuted(current.muted);
    setSoundVolume(Math.round(current.volume * 100));
  }, []);

  function persistSoundSettings(muted: boolean, volumePct: number) {
    const safe = Math.max(0, Math.min(100, volumePct));
    setSoundMuted(muted);
    setSoundVolume(safe);
    setSoundSettings({ muted, volume: safe / 100 });
    try {
      window.localStorage.setItem(
        'shortdeck:sound-settings:v1',
        JSON.stringify({ muted, volume: safe })
      );
    } catch {
      // ignore storage errors
    }
  }

  return (
    <div
      className="h-screen overflow-hidden text-white"
      style={{ background: 'radial-gradient(circle at 50% 10%, #2b2f3a 0%, #1a1d26 45%, #12141b 100%)' }}
    >
      <div className="relative h-full overflow-hidden">
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `scale(${uiScale})`,
            width: `${100 / uiScale}%`,
            height: `${100 / uiScale}%`,
          }}
        >
        <div className="absolute top-3 right-24 z-30 text-right">
          <div className="text-xs uppercase tracking-wide text-gray-400">Owner: wall</div>
          <div className="mt-1 text-2xl font-bold leading-tight text-gray-300">NLH ~ 10 / 20</div>
        </div>

        <button
          onClick={onLeave}
          className="absolute left-3 top-3 z-30 w-[72px] h-[72px] rounded-lg border border-white/25 bg-black/55 hover:bg-black/70 text-white text-sm font-bold tracking-wide"
        >
          Poker
        </button>

        <aside className="hidden md:flex absolute left-3 top-24 z-20 flex-col gap-2">
          <SquareTool icon="☰" label="OPTIONS" />
          <SquareTool
            icon="📘"
            label="比大小"
            active={showRulesModal}
            onClick={() => setShowRulesModal(v => !v)}
          />
          <SquareTool
            icon={isAway ? '↩' : '🧍'}
            label={isAway ? 'I AM BACK' : 'AWAY'}
            active={isAway}
            onClick={() => onSetAway(!isAway)}
          />
        </aside>

        <aside className="hidden md:flex absolute right-3 top-24 z-20 flex-col gap-2">
          <SquareTool
            icon={soundMuted ? '🔇' : '🔊'}
            active={showSoundPanel}
            onClick={() => setShowSoundPanel(v => !v)}
          />
          <SquareTool
            icon={isGamePaused ? '▶' : '⏸'}
            active={isGamePaused}
            onClick={() => onSetPause(!isGamePaused)}
          />
          <SquareTool icon="■" />
        </aside>

        {showSoundPanel && (
          <div className="absolute top-3 right-24 z-30 w-[280px] rounded-lg border border-white/20 bg-black/80 p-3">
            <div className="text-xs uppercase tracking-widest text-white/60">Sound</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-sm text-white/90">Mute</span>
              <button
                onClick={() => persistSoundSettings(!soundMuted, soundVolume)}
                className={clsx(
                  'px-3 py-1 rounded text-sm font-semibold',
                  soundMuted ? 'bg-rose-700 hover:bg-rose-600' : 'bg-emerald-700 hover:bg-emerald-600'
                )}
              >
                {soundMuted ? 'On' : 'Off'}
              </button>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-sm text-white/80 mb-1">
                <span>Volume</span>
                <span>{soundVolume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={soundVolume}
                onChange={(e) => persistSoundSettings(soundMuted, Number(e.target.value))}
                className="w-full accent-yellow-400"
              />
            </div>
          </div>
        )}

        {isHost && joinRequests.length > 0 && (
          <div className="absolute top-3 right-24 z-30 w-[360px] space-y-2">
            {joinRequests.map((req) => (
              <JoinRequestCard
                key={req.requestId}
                req={req}
                defaultBuyIn={room.settings.startingChips}
                onDecision={onJoinRequestDecision}
              />
            ))}
          </div>
        )}

        {showRulesModal && (
          <RulesModal onClose={() => setShowRulesModal(false)} />
        )}

        {isHost && manageTarget && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35">
            <div className="w-[360px] rounded-xl border border-white/20 bg-black/85 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
              <div className="text-xs uppercase tracking-widest text-white/60">Player Control</div>
              <div className="mt-1 text-lg font-semibold text-white">{manageTarget.name}</div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={manageChips}
                  onChange={(e) => setManageChips(e.target.value)}
                  className="w-36 bg-black/50 border border-white/25 rounded px-2 py-1.5 text-sm"
                />
                <button
                  disabled={managing}
                  onClick={async () => {
                    setManaging(true);
                    const res = await onHostManagePlayer(
                      manageTarget.id,
                      'set_chips',
                      Math.max(0, Math.floor(Number(manageChips) || 0))
                    );
                    setManaging(false);
                    if (!res.success) return alert(res.error || 'Set chips failed');
                    setManageTargetId(null);
                  }}
                  className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-sm font-semibold disabled:opacity-50"
                >
                  {managing ? 'Saving...' : 'Set Chips'}
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  disabled={managing}
                  onClick={async () => {
                    if (!confirm(`Kick ${manageTarget.name}?`)) return;
                    setManaging(true);
                    const res = await onHostManagePlayer(manageTarget.id, 'kick');
                    setManaging(false);
                    if (!res.success) return alert(res.error || 'Kick failed');
                    setManageTargetId(null);
                  }}
                  className="px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-sm font-semibold disabled:opacity-50"
                >
                  Kick Player
                </button>
                <button
                  disabled={managing}
                  onClick={() => setManageTargetId(null)}
                  className="ml-auto px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-sm disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="h-full w-full flex items-center justify-center px-2 py-1 md:px-4">
          <div className="relative w-full max-w-5xl" style={{ paddingBottom: '47%' }}>
          {/* Oval felt table */}
          <div
            className="absolute inset-0 rounded-[50%] border-[6px] border-black/35"
            style={{
              background: 'radial-gradient(ellipse at 50% 40%, #4eaa6a 0%, #3d9560 50%, #2f7f50 100%)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.06)',
            }}
          >
            <div className="absolute top-[34%] left-[24%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
              <div
                className="aspect-square rounded-xl overflow-hidden border border-white/45 shadow-[0_8px_22px_rgba(0,0,0,0.45)] bg-black/25"
                style={{ width: '11.5%', minWidth: '68px', maxWidth: '132px' }}
              >
                <img
                  src="/dealer-avatar.webp"
                  alt="Dealer"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Community cards + pot */}
            <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
              <div className="px-14 py-1 rounded-full bg-black/18 border border-black/15 font-semibold text-4xl">
                {formatChips(gameState.pot)}
              </div>

              {showBothRunBoards && showPreflopRunGrid ? (
                <div className="mt-1 flex flex-col items-center gap-2">
                  <div className="flex gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run1-${i}`}
                        card={runItTwice?.boards?.[0]?.[i]}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run2-${i}`}
                        card={gameState.communityCards[i]}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              ) : showBothRunBoards && showFlopRunGrid ? (
                <div className="mt-1 flex flex-col items-center gap-2">
                  <div className="flex gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run1-${i}`}
                        card={runItTwice?.boards?.[0]?.[i]}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-5 gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run2-${i}`}
                        card={i >= 3 ? gameState.communityCards[i] : undefined}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              ) : showBothRunBoards && showTurnRunGrid ? (
                <div className="mt-1 flex flex-col items-center gap-2">
                  <div className="flex gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run1-${i}`}
                        card={runItTwice?.boards?.[0]?.[i]}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-5 gap-2.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Card
                        key={`run2-slot-${i}`}
                        card={i === 4 ? gameState.communityCards[4] : undefined}
                        faceDown={false}
                        size="xl"
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              ) : showBothRunBoards ? (
                <div className="mt-1 flex flex-col items-center gap-2">
                  {sharedStreetCount > 0 && (
                    <div className="flex gap-2.5">
                      {Array.from({ length: sharedStreetCount }).map((_, i) => (
                        <Card
                          key={`shared-${i}`}
                          card={runItTwice?.boards?.[0]?.[i]}
                          faceDown={false}
                          size="xl"
                          index={i}
                        />
                      ))}
                    </div>
                  )}
                  {newStreetIndices.length > 0 && (
                    <div className="flex items-center gap-4">
                      {newStreetIndices.map((i) => (
                        <div key={`pair-${i}`} className="flex items-center gap-2.5">
                          <Card
                            key={`run1-${i}`}
                            card={runItTwice?.boards?.[0]?.[i]}
                            faceDown={false}
                            size="xl"
                            index={i}
                          />
                          <Card
                            key={`run2-${i}`}
                            card={gameState.communityCards[i]}
                            faceDown={false}
                            size="xl"
                            index={i}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {newStreetIndices.length === 0 && (
                    <div className="flex gap-2.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Card
                          key={`run2-${i}`}
                          card={i < sharedStreetCount ? undefined : gameState.communityCards[i]}
                          faceDown={false}
                          size="xl"
                          index={i}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2.5 mt-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Card
                      key={i}
                      card={gameState.communityCards[i]}
                      faceDown={false}
                      size="xl"
                      index={i}
                    />
                  ))}
                </div>
              )}

              {showHandResult && handResult && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <div className="text-sm text-yellow-200 bg-black/30 rounded-xl px-4 py-2 border border-yellow-300/30 leading-tight">
                    {runItTwice?.summary?.length ? (
                      runItTwice.summary.map((item, idx) => (
                        <div key={`${item.name}-${idx}`}>
                          {item.name}: {item.handLabel}
                        </div>
                      ))
                    ) : (
                      showdownPlayers.slice(0, 2).map((p) => (
                        <div key={p.id}>
                          {p.name}: {formatHandLabelEnDetailed(p.handResult)}
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowHandResult(false);
                      setHandResult(null);
                      onNextHand();
                    }}
                    className="px-6 py-2 rounded-lg border border-white/40 bg-black/30 hover:bg-black/45 text-white font-semibold"
                  >
                    继续下一局
                  </button>
                </div>
              )}
              {isGamePaused && (
                <div className="mt-2 px-5 py-2 rounded-lg border border-yellow-300/40 bg-black/35 text-yellow-200 font-semibold">
                  GAME PAUSED
                </div>
              )}
            </div>
          </div>

          {/* Player seats */}
          {orderedRoomPlayers.map((roomPlayer, displayIdx) => {
            const pos = SEAT_POSITIONS[displayIdx] || SEAT_POSITIONS[0];
            const inHand = inHandById.get(roomPlayer.id);
            const seatPlayer = inHand?.player ?? {
              id: roomPlayer.id,
              name: roomPlayer.name,
              color: roomPlayer.color,
              chips: roomPlayer.chips,
              bet: 0,
              totalBet: 0,
              holeCards: [],
              folded: false,
              allIn: false,
              isBot: roomPlayer.isBot,
              isConnected: roomPlayer.isConnected,
              seatIndex: roomPlayer.seatIndex,
              revealedMask: 0,
              revealedCount: 0,
            };
            const origIdx = inHand?.idx ?? -1;

            return (
              <div
                key={roomPlayer.id}
                className={clsx(
                  'absolute -translate-x-1/2 -translate-y-1/2',
                  isHost && roomPlayer.id !== myPlayerId && 'cursor-pointer'
                )}
                style={{ top: pos.top, left: pos.left }}
                onClick={() => {
                  if (!isHost || roomPlayer.id === myPlayerId) return;
                  setManageTargetId(roomPlayer.id);
                }}
              >
                <PlayerSeat
                  player={seatPlayer}
                  isDealer={origIdx === gameState.dealerIndex}
                  isSmallBlind={origIdx === gameState.smallBlindIndex}
                  isBigBlind={origIdx === gameState.bigBlindIndex}
                  isActive={origIdx === gameState.currentPlayerIndex}
                  isMe={roomPlayer.id === myPlayerId}
                  isShowdown={gameState.stage === 'showdown'}
                  isWinner={winnerIds.has(roomPlayer.id)}
                  communityCards={gameState.communityCards}
                  winsCount={winsByPlayer[roomPlayer.id] || 0}
                  statusText={!inHand ? (roomPlayer.isAway ? 'AWAY' : 'WAIT NEXT HAND') : undefined}
                  showCheckBubble={inHand?.player.bet === 0 && checkBubblePlayers.has(roomPlayer.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
        <div className="absolute bottom-2 left-2 md:left-3 z-20 w-[330px] md:w-[470px]">
          <div className="rounded-lg border border-white/15 bg-black/35 p-2">
            <div className="text-xs text-white/60 mb-1">LOG / LEDGER</div>
            <div className="space-y-1 min-h-[64px]">
              {recentChat.length === 0 && <div className="text-xs text-white/45">No messages</div>}
              {recentChat.map(msg => (
                <div key={msg.id} className="text-sm text-white/85 truncate">
                  <span className="text-emerald-300">{msg.playerName}: </span>{msg.message}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && chatInput.trim()) {
                    onSendChat(chatInput.trim());
                    setChatInput('');
                  }
                }}
                placeholder="Type message..."
                className="flex-1 bg-black/45 border border-white/20 rounded px-2 py-1 text-sm text-white placeholder:text-white/40 outline-none"
              />
              <button
                onClick={() => {
                  if (!chatInput.trim()) return;
                  onSendChat(chatInput.trim());
                  setChatInput('');
                }}
                className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-sm"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-2 right-2 md:right-3 z-20 flex flex-col items-end gap-2 w-[560px] max-w-[calc(100vw-16px)]">
          {showRunItTwicePanel && (
            <div className="w-[312px] rounded-xl overflow-hidden border-[3px] border-white/25 bg-[#121722]/92 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
              <div className="px-3 pt-4 pb-3 text-center font-extrabold tracking-wide text-[1.35rem] leading-none text-white">
                RUN IT TWICE?
              </div>
              <div className="grid grid-cols-2 border-t border-white/20">
                <button
                  onClick={() => onRunItTwiceVote(true)}
                  disabled={myRunItTwiceVote !== null}
                  className={clsx(
                    'px-3 py-3 font-extrabold text-[1.7rem] border-r border-white/20 transition-colors',
                    myRunItTwiceVote === true ? 'bg-emerald-600 text-white' : 'bg-emerald-700/85 text-white hover:bg-emerald-600',
                    myRunItTwiceVote !== null && myRunItTwiceVote !== true && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  YES
                </button>
                <button
                  onClick={() => onRunItTwiceVote(false)}
                  disabled={myRunItTwiceVote !== null}
                  className={clsx(
                    'px-3 py-3 font-extrabold text-[1.7rem] transition-colors',
                    myRunItTwiceVote === false ? 'bg-rose-600 text-white' : 'bg-rose-700/90 text-white hover:bg-rose-600',
                    myRunItTwiceVote !== null && myRunItTwiceVote !== false && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  NO
                </button>
              </div>
            </div>
          )}
          {(showHandResult || gameState.stage === 'showdown') && myPlayer && (
            <div
              className={clsx(
                'relative w-[312px] rounded-xl overflow-hidden border-[3px] border-[#25d483] shadow-[0_10px_24px_rgba(0,0,0,0.35)]',
                myRevealMask === 3 ? 'bg-[#35b973]' : 'bg-[#121722]/92'
              )}
            >
              <span
                className={clsx(
                  'absolute right-3 top-2 text-[1.7rem] font-bold leading-none',
                  myRevealMask === 3 ? 'text-white' : 'text-[#2edd8f]'
                )}
              >
                s
              </span>
              <button
                type="button"
                onClick={() => {
                  if ((myRevealMask & 1) === 0) onRevealCards(1);
                  if ((myRevealMask & 2) === 0) onRevealCards(2);
                }}
                disabled={myRevealMask === 3}
                className={clsx(
                  'w-full px-3 pt-4 pb-3 text-center font-extrabold tracking-wide text-[1.55rem] leading-none whitespace-nowrap',
                  myRevealMask !== 3 && 'hover:bg-black/10',
                  myRevealMask === 3 && 'cursor-default',
                  myRevealMask === 3 ? 'text-white' : 'text-[#2edd8f]'
                )}
              >
                SHOW ALL CARDS
              </button>
              <div className="grid grid-cols-2 border-t-[2px] border-[#25d483]">
                <button
                  onClick={() => onRevealCards(1)}
                  disabled={(myRevealMask & 1) !== 0}
                  className={clsx(
                    'relative px-3 pt-3 pb-4 font-extrabold text-[2.3rem] leading-none border-r-[2px] border-[#25d483] transition-colors',
                    (myRevealMask & 1) !== 0
                      ? 'bg-[#35b973] text-white'
                      : 'bg-transparent text-[#2edd8f] hover:bg-black/10'
                  )}
                >
                  {cardShortLabel(myPlayer.holeCards?.[0])}
                </button>
                <button
                  onClick={() => onRevealCards(2)}
                  disabled={(myRevealMask & 2) !== 0}
                  className={clsx(
                    'relative px-3 pt-3 pb-4 font-extrabold text-[2.3rem] leading-none transition-colors',
                    (myRevealMask & 2) !== 0
                      ? 'bg-[#35b973] text-white'
                      : 'bg-transparent text-[#2edd8f] hover:bg-black/10'
                  )}
                >
                  {cardShortLabel(myPlayer.holeCards?.[1])}
                </button>
              </div>
            </div>
          )}
          {!showHandResult && gameState.stage !== 'showdown' && isMyTurn && (
            <>
              <div className="text-yellow-300 font-semibold text-3xl tracking-wide">YOUR TURN</div>
              <div className="bg-white/92 text-black text-4 font-semibold px-6 py-2 rounded-lg">EXTRA TIME ACTIVATED</div>
            </>
          )}
          {!showHandResult && gameState.stage !== 'showdown' && !showRaisePanel && (
            <div className={clsx('grid gap-2 w-full', showPrimaryAction ? 'grid-cols-4' : 'grid-cols-3')}>
            {showPrimaryAction && (
              <ActionBox
                hotkey="C"
                label={callAmt > 0 ? `CALL ${formatChips(callAmt)}` : `BET ${formatChips(gameState.bigBlind)}`}
                disabled={!canAct}
                onClick={() => {
                  if (!canAct) return;
                  if (callAmt > 0) {
                    onAction('call');
                  } else if (canQuickBet) {
                    onAction('raise', minRaise);
                  }
                }}
              />
            )}
            <ActionBox
              hotkey="R"
              label="RAISE"
              disabled={!canAct || !canRaise}
              onClick={() => {
                if (!canAct || !canRaise || !myPlayer) return;
                const bbDefault = gameState.currentBet + gameState.bigBlind;
                const initial = Math.min(maxTotalBet, Math.max(minRaise, bbDefault));
                setRaiseAmount(initial);
                setShowRaisePanel(true);
              }}
            />
            <ActionBox
              hotkey="K"
              label="CHECK"
              disabled={!canAct || !canCheck}
              onClick={() => canAct && canCheck && onAction('check')}
            />
            <ActionBox
              hotkey="F"
              label="FOLD"
              danger
              disabled={!canAct}
              onClick={() => canAct && onAction('fold')}
            />
            </div>
          )}
          {!showHandResult && gameState.stage !== 'showdown' && canAct && myPlayer && canRaise && showRaisePanel && (
            <div className="w-full rounded-xl border border-white/15 bg-black/45 p-2 space-y-2">
              <div className="flex items-stretch gap-2">
                <div className="w-[180px] rounded-lg border border-white/15 bg-white/5 p-2 text-center">
                  <div className="text-white/55 text-xs uppercase">Your Bet</div>
                  <div className="mt-1 inline-flex items-center justify-center bg-emerald-700 px-4 py-1 rounded text-3xl font-bold">
                    {formatChips(safeRaise)}
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-5 gap-2">
                  {[
                    { label: 'MIN RAISE', val: minRaise },
                    { label: '1/2 POT', val: presetRaiseTo(0.5) },
                    { label: '3/4 POT', val: presetRaiseTo(0.75) },
                    { label: 'POT', val: presetRaiseTo(1) },
                    { label: 'ALL IN', val: maxTotalBet },
                  ].map((p) => {
                    const clamped = Math.min(Math.max(p.val, minRaise), maxTotalBet);
                    return (
                      <button
                        key={p.label}
                        onClick={() => setRaiseAmount(clamped)}
                        className="rounded-lg border border-white/20 bg-white/5 hover:bg-white/10 text-sm font-semibold"
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border border-white/15 bg-white/5 p-2 flex items-center gap-3">
                <button
                  onClick={() => setRaiseAmount(Math.max(minRaise, safeRaise - gameState.bigBlind))}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 text-3xl leading-none"
                >
                  -
                </button>
                <input
                  type="range"
                  min={minRaise}
                  max={maxTotalBet}
                  step={Math.max(1, gameState.bigBlind)}
                  value={safeRaise}
                  onChange={(e) => setRaiseAmount(parseInt(e.target.value, 10))}
                  className="flex-1 accent-yellow-400"
                />
                <button
                  onClick={() => setRaiseAmount(Math.min(maxTotalBet, safeRaise + gameState.bigBlind))}
                  className="w-10 h-10 rounded bg-white/10 hover:bg-white/20 text-3xl leading-none"
                >
                  +
                </button>
                <button
                  onClick={() => setShowRaisePanel(false)}
                  className="ml-2 rounded-lg border border-white/40 px-6 py-2 text-2xl font-semibold"
                >
                  BACK
                </button>
                <button
                  onClick={() => {
                    onAction('raise', safeRaise);
                    setShowRaisePanel(false);
                  }}
                  className="rounded-lg border border-emerald-500 text-emerald-400 px-6 py-2 text-2xl font-semibold"
                >
                  RAISE
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

    </div>
  );
}

function JoinRequestCard({
  req, defaultBuyIn, onDecision,
}: {
  req: JoinRequest;
  defaultBuyIn: number;
  onDecision: (requestId: string, approve: boolean, buyIn?: number) => void;
}) {
  const [buyIn, setBuyIn] = useState<number>(defaultBuyIn);
  return (
    <div className="rounded-lg border border-amber-300/40 bg-black/70 px-3 py-2">
      <div className="text-xs text-amber-300/90 uppercase tracking-widest">Join Request</div>
      <div className="text-white text-sm mt-1">
        <span className="font-semibold">{req.playerName}</span> wants to join
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-white/70">Buy-in</span>
        <input
          type="number"
          value={buyIn}
          min={1}
          step={1}
          onChange={(e) => setBuyIn(Math.max(1, Math.floor(Number(e.target.value) || defaultBuyIn)))}
          className="w-24 bg-black/40 border border-white/20 rounded px-2 py-1 text-sm"
        />
        <button
          onClick={() => onDecision(req.requestId, true, buyIn)}
          className="ml-auto px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold"
        >
          Approve
        </button>
        <button
          onClick={() => onDecision(req.requestId, false)}
          className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-sm font-semibold"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function SquareTool({
  icon, label, onClick, active,
}: {
  icon: string;
  label?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-[72px] h-[72px] rounded-lg border transition-colors flex flex-col items-center justify-center',
        active
          ? 'border-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/30'
          : 'border-white/20 bg-black/35 hover:bg-black/55'
      )}
    >
      <span className="text-3xl leading-none">{icon}</span>
      {label && <span className="text-[10px] text-white/60 mt-1">{label}</span>}
    </button>
  );
}

function ActionBox({
  hotkey, label, onClick, disabled, danger,
}: {
  hotkey: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'relative rounded-lg border text-left px-3 py-3 h-[86px] transition-all',
        disabled
          ? 'bg-black/25 border-white/10 text-white/30'
          : danger
            ? 'bg-black/35 border-orange-500 text-orange-400 hover:bg-black/50'
            : 'bg-black/35 border-emerald-500 text-emerald-300 hover:bg-black/50'
      )}
    >
      <span className="absolute top-1 right-2 text-xs text-white/45">{hotkey}</span>
      <span className="text-3xl font-semibold">{label}</span>
    </button>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const rows: Array<{ en: string; zh: string; cards: Array<{ rank: string; suit: string }> }> = [
    { en: 'Royal Flush', zh: '皇家同花顺', cards: [{ rank: 'T', suit: '♠' }, { rank: 'J', suit: '♠' }, { rank: 'Q', suit: '♠' }, { rank: 'K', suit: '♠' }, { rank: 'A', suit: '♠' }] },
    { en: 'Straight Flush', zh: '同花顺', cards: [{ rank: '9', suit: '♥' }, { rank: 'T', suit: '♥' }, { rank: 'J', suit: '♥' }, { rank: 'Q', suit: '♥' }, { rank: 'K', suit: '♥' }] },
    { en: 'Four of a Kind', zh: '四条', cards: [{ rank: 'K', suit: '♣' }, { rank: 'K', suit: '♦' }, { rank: 'K', suit: '♥' }, { rank: 'K', suit: '♠' }, { rank: 'A', suit: '♣' }] },
    { en: 'Flush', zh: '同花', cards: [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♠' }, { rank: '9', suit: '♠' }, { rank: '7', suit: '♠' }] },
    { en: 'Full House', zh: '葫芦', cards: [{ rank: 'A', suit: '♥' }, { rank: 'A', suit: '♦' }, { rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }, { rank: 'K', suit: '♣' }] },
    { en: 'Straight (A-6-7-8-9)', zh: '顺子（A-6-7-8-9）', cards: [{ rank: 'A', suit: '♣' }, { rank: '6', suit: '♦' }, { rank: '7', suit: '♠' }, { rank: '8', suit: '♥' }, { rank: '9', suit: '♣' }] },
    { en: 'Three of a Kind', zh: '三条', cards: [{ rank: 'Q', suit: '♣' }, { rank: 'Q', suit: '♦' }, { rank: 'Q', suit: '♥' }, { rank: '9', suit: '♠' }, { rank: '8', suit: '♣' }] },
    { en: 'Two Pair', zh: '两对', cards: [{ rank: 'A', suit: '♣' }, { rank: 'A', suit: '♦' }, { rank: 'K', suit: '♥' }, { rank: 'K', suit: '♠' }, { rank: '7', suit: '♣' }] },
    { en: 'One Pair', zh: '一对', cards: [{ rank: 'A', suit: '♣' }, { rank: 'A', suit: '♦' }, { rank: 'Q', suit: '♥' }, { rank: '9', suit: '♠' }, { rank: '7', suit: '♣' }] },
    { en: 'High Card', zh: '高牌', cards: [{ rank: 'A', suit: '♣' }, { rank: 'K', suit: '♦' }, { rank: 'Q', suit: '♥' }, { rank: '9', suit: '♠' }, { rank: '7', suit: '♣' }] },
  ];

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/40 pt-8 md:pt-12">
      <div className="w-[780px] max-w-[92vw] rounded-xl border border-white/20 bg-[#141821] text-white p-4 shadow-[0_20px_45px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold">短牌比大小（当前版本）</div>
          <button
            onClick={onClose}
            className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-sm"
          >
            关闭
          </button>
        </div>

        <div className="mt-3 text-xs text-white/65">
          从大到小（可滚动）
        </div>

        <div className="mt-2 max-h-[66vh] overflow-y-auto space-y-2 pr-1">
          {rows.map((row, idx) => (
            <div key={row.en} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2 gap-2">
              <div className="w-52 text-sm font-semibold text-amber-200">{idx + 1}. {row.en} / {row.zh}</div>
              <div className="flex gap-2">
                {row.cards.map((c, i) => (
                  <RuleCard key={`${row.en}-${i}`} rank={c.rank} suit={c.suit} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 text-xs text-white/75">
          短牌规则提示：同花 &gt; 葫芦；顺子 &gt; 三条；A-6-7-8-9 为最小顺子。
        </div>
      </div>
    </div>
  );
}

function RuleCard({ rank, suit }: { rank: string; suit: string }) {
  const red = suit === '♥' || suit === '♦';
  const rankLabel = rank === 'T' ? '10' : rank;
  return (
    <div className="relative w-12 h-16 rounded-lg bg-[#f6f6f6] border border-white/80 shadow-sm overflow-hidden">
      <span className={clsx(
        'absolute top-1 left-1.5 text-[25px] font-extrabold leading-none',
        red ? 'text-red-600' : 'text-slate-900'
      )}>
        {rankLabel}
      </span>
      <span className={clsx(
        'absolute bottom-1 right-1.5 text-[24px] font-bold leading-none',
        red ? 'text-red-600' : 'text-slate-900'
      )}>
        {suit}
      </span>
    </div>
  );
}

// ============================================================
// Hand Result Modal
// ============================================================
