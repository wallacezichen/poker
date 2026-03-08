'use client';
import { useEffect, useRef, useState } from 'react';
import { GameState, Room, JoinRequest } from '../types/poker';
import Card from './Card';
import PlayerSeat from './PlayerSeat';
import { useGameStore } from '../store/gameStore';
import clsx from 'clsx';

// Seat positions as percentage [top, left] on the oval table
// Position 0 = bottom center (always my seat), others go clockwise
const SEAT_POSITIONS: Array<{ top: string; left: string }> = [
  { top: '82%', left: '50%' },   // 0 - bottom center (me)
  { top: '68%', left: '16%' },   // 1 - bottom left
  { top: '38%', left: '5%' },    // 2 - left
  { top: '12%', left: '18%' },   // 3 - top left
  { top: '8%',  left: '50%' },   // 4 - top center
  { top: '12%', left: '82%' },   // 5 - top right
  { top: '38%', left: '93%' },   // 6 - right
  { top: '68%', left: '84%' },   // 7 - bottom right
  { top: '50%', left: '50%' },   // 8 - center (overflow)
];

function formatChips(n: number): string {
  return String(n);
}

interface GameTableProps {
  gameState: GameState;
  room: Room;
  myPlayerId: string;
  onAction: (action: any, amount?: number) => void;
  onSendChat: (msg: string) => void;
  onSetAway: (away: boolean) => void;
  onJoinRequestDecision: (requestId: string, approve: boolean, buyIn?: number) => void;
  onSetPause: (paused: boolean) => void;
  onNextHand: () => void;
  onLeave: () => void;
}

export default function GameTable({
  gameState, room, myPlayerId,
  onAction, onSendChat, onSetAway, onJoinRequestDecision, onSetPause, onNextHand, onLeave
}: GameTableProps) {
  const {
    chatMessages, joinRequests,
    timerSeconds, handResult, showHandResult, setShowHandResult, setHandResult, isGamePaused,
  } = useGameStore();

  const [raiseAmount, setRaiseAmount] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [winsByPlayer, setWinsByPlayer] = useState<Record<string, number>>({});
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [uiScale, setUiScale] = useState(1);
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

  return (
    <div
      className="flex flex-col h-screen overflow-hidden text-white"
      style={{ background: 'radial-gradient(circle at 50% 10%, #2b2f3a 0%, #1a1d26 45%, #12141b 100%)' }}
    >
      <header className="shrink-0 flex items-center justify-between px-2 py-1.5 bg-black/25 border-b border-white/10 z-20">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold tracking-wide text-white/95">POKER NOW</span>
          <button className="text-xs px-3 py-1 rounded bg-white/12 hover:bg-white/18">Your Profile</button>
          <button className="text-xs px-3 py-1 rounded bg-white/12 hover:bg-white/18" onClick={onLeave}>Logout</button>
        </div>

        <div className="text-right pr-1">
          <div className="text-white/50 text-xs uppercase">Owner: {ownerName}</div>
          <div className="font-bold text-2xl md:text-3xl tracking-wide">
            NLH ~ {gameState.smallBlind} / {gameState.bigBlind}
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `scale(${uiScale})`,
            width: `${100 / uiScale}%`,
            height: `${100 / uiScale}%`,
          }}
        >
        <aside className="hidden md:flex absolute left-3 top-2 z-20 flex-col gap-2">
          <SquareTool icon="☰" label="OPTIONS" />
          <SquareTool
            icon={isAway ? '↩' : '🧍'}
            label={isAway ? 'I AM BACK' : 'AWAY'}
            active={isAway}
            onClick={() => onSetAway(!isAway)}
          />
        </aside>

        <aside className="hidden md:flex absolute right-3 top-3 z-20 flex-col gap-2">
          <SquareTool icon="🔊" />
          <SquareTool
            icon={isGamePaused ? '▶' : '⏸'}
            active={isGamePaused}
            onClick={() => onSetPause(!isGamePaused)}
          />
          <SquareTool icon="■" />
        </aside>

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
            {/* Dealer avatar */}
            <div className="absolute top left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
              <div className="w-32 h-32 rounded-xl overflow-hidden border border-white/45 shadow-[0_8px_22px_rgba(0,0,0,0.45)] bg-black/25">
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

              <div className="flex gap-2.5 mt-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Card
                    key={i}
                    card={gameState.communityCards[i]}
                    faceDown={false}
                    size="lg"
                    index={i}
                  />
                ))}
              </div>

              {showHandResult && handResult && (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <div className="text-sm text-yellow-200 bg-black/30 rounded-full px-4 py-1 border border-yellow-300/30">
                    {handResult.winners.map(w => `${w.name} · ${w.handNameZh}`).join('  /  ')}
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
            };
            const origIdx = inHand?.idx ?? -1;

            return (
              <div
                key={roomPlayer.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ top: pos.top, left: pos.left }}
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
                  timerSeconds={origIdx === gameState.currentPlayerIndex ? timerSeconds : 30}
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
          {isMyTurn && (
            <>
              <div className="text-yellow-300 font-semibold text-3xl tracking-wide">YOUR TURN</div>
              <div className="bg-white/92 text-black text-4 font-semibold px-6 py-2 rounded-lg">EXTRA TIME ACTIVATED</div>
            </>
          )}
          {!showRaisePanel && (
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
          {canAct && myPlayer && canRaise && showRaisePanel && (
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

// ============================================================
// Hand Result Modal
// ============================================================
