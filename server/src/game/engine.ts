import { v4 as uuidv4 } from 'uuid';
import {
  Card, GameState, PlayerState, ActionType,
  WinnerInfo, ActionLogEntry, RoomSettings, GameStage, GameType, HandResult
} from '../types/poker';
import { createDeck, evaluateHand, compareHands } from './handEvaluator';

// ============================================================
// Game Engine - pure functions that operate on GameState
// ============================================================

export interface FullGameState extends GameState {
  deck: Card[];
  deckIndex: number;
  // Internal-only tracking for betting rounds (not sent to clients)
  playersToAct: string[];
}

function dealCard(state: FullGameState): Card {
  if (state.deckIndex >= state.deck.length) {
    state.deck = createDeck(state.gameType ?? 'short_deck');
    state.deckIndex = 0;
  }
  return state.deck[state.deckIndex++];
}

function getActiveActorIds(state: FullGameState): string[] {
  return state.players.filter(p => !p.folded && !p.allIn).map(p => p.id);
}

function setPlayersToActAll(state: FullGameState, exceptPlayerId?: string): void {
  state.playersToAct = getActiveActorIds(state).filter(id => id !== exceptPlayerId);
}

function ensurePlayersWhoOweCall(state: FullGameState): void {
  const owed = state.players
    .filter(p => !p.folded && !p.allIn && p.bet < state.currentBet)
    .map(p => p.id);
  for (const id of owed) {
    if (!state.playersToAct.includes(id)) state.playersToAct.push(id);
  }
}

function removePlayerToAct(state: FullGameState, playerId: string): void {
  state.playersToAct = state.playersToAct.filter(id => id !== playerId);
}

function countLiveNotAllIn(state: FullGameState): number {
  return state.players.filter(p => !p.folded && !p.allIn).length;
}

function getMinRaiseTo(state: FullGameState): number {
  const lastFullRaiseSize = state.lastRaiseSize ?? state.bigBlind;
  return state.currentBet + lastFullRaiseSize;
}

function bitCount(mask: number): number {
  let m = mask >>> 0;
  let c = 0;
  while (m) {
    m &= (m - 1) >>> 0;
    c++;
  }
  return c;
}

function fullRevealMaskForCount(n: number): number {
  const safe = Math.max(0, Math.min(30, Math.floor(n)));
  return safe <= 0 ? 0 : ((1 << safe) - 1);
}

function publicHoleCardsByIndex(holeCards: Card[], mask: number): Array<Card | null> {
  const n = holeCards.length;
  const res: Array<Card | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const bit = 1 << i;
    if ((mask & bit) !== 0) res[i] = holeCards[i] ?? null;
  }
  return res;
}

function publicHoleCardsForMask(holeCards: Card[], mask: number): Card[] {
  if (holeCards.length === 3) {
    if (mask === 7) return holeCards.slice();
    if (mask === 3) return holeCards.slice(0, 2);
    if (mask === 5) return [holeCards[0], holeCards[2]].filter(Boolean);
    if (mask === 6) return [holeCards[1], holeCards[2]].filter(Boolean);
    if (mask === 1) return holeCards[0] ? [holeCards[0]] : [];
    if (mask === 2) return holeCards[1] ? [holeCards[1]] : [];
    if (mask === 4) return holeCards[2] ? [holeCards[2]] : [];
    return [];
  }
  if (holeCards.length > 3) {
    const full = fullRevealMaskForCount(holeCards.length);
    return mask === full ? holeCards.slice() : [];
  }
  if (mask === 3) return holeCards.slice(0, 2);
  if (mask === 1) return holeCards[0] ? [holeCards[0]] : [];
  if (mask === 2) return holeCards[1] ? [holeCards[1]] : [];
  return [];
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

function formatHandLabelEnDetailed(result: ReturnType<typeof evaluateHand>): string {
  if (result.rank >= 4) return result.name;
  if (result.rank === 3) {
    const trip = result.tiebreak[0] || 0;
    return `Set of ${rankWord(trip)}`;
  }
  if (result.rank === 2) {
    const p1 = result.tiebreak[0] || 0;
    const p2 = result.tiebreak[1] || 0;
    return `Two Pair(${rankWord(p1)}, ${rankWord(p2)})`;
  }
  if (result.rank === 1) {
    const p = result.tiebreak[0] || 0;
    return `One Pair(${rankWord(p)})`;
  }
  const hi = result.tiebreak[0] || 0;
  return `${valueToRank(hi)}-high`;
}

function communityCountForStage(stage: GameStage): number {
  if (stage === 'flop') return 3;
  if (stage === 'flop_discard') return 3;
  if (stage === 'turn') return 4;
  if (stage === 'river' || stage === 'showdown') return 5;
  return 0;
}

function combos<T>(arr: T[], k: number): T[][] {
  if (k === arr.length) return [arr];
  if (k === 1) return arr.map(x => [x]);
  const out: T[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    for (const tail of combos(arr.slice(i + 1), k - 1)) out.push([arr[i], ...tail]);
  }
  return out;
}

function evaluatePlayerHandForVariant(player: PlayerState, board: Card[], gameType: GameType): HandResult {
  if (gameType !== 'omaha') {
    return evaluateHand([...player.holeCards, ...board], gameType);
  }

  if (player.holeCards.length < 2 || board.length < 3) {
    return { rank: -1, name: 'Invalid', nameZh: '无效', tiebreak: [] };
  }

  let best: HandResult | null = null;
  let bestCards: Card[] = [];
  for (const hole of combos(player.holeCards, 2)) {
    for (const brd of combos(board, 3)) {
      const candidateCards = [...hole, ...brd];
      const candidate = evaluateHand(candidateCards, 'regular');
      if (!best || compareHands(candidate, best) > 0) {
        best = candidate;
        bestCards = candidateCards;
      } else if (best && compareHands(candidate, best) === 0) {
        const seen = new Set(bestCards.map(c => `${c.rank}${c.suit}`));
        for (const c of candidateCards) {
          const key = `${c.rank}${c.suit}`;
          if (!seen.has(key)) {
            seen.add(key);
            bestCards.push(c);
          }
        }
      }
    }
  }

  return { ...best!, cards: bestCards };
}

function evaluateSingleRunWinners(
  state: FullGameState,
  board: Card[],
  runIndex: 0 | 1
): WinnerInfo[] {
  const contenders = state.players.filter(p => !p.folded);
  const hasAllInContender = contenders.some(p => p.allIn);
  const forceFullReveal = hasAllInContender || (state.gameType === 'omaha' || state.gameType === 'crazy_pineapple');
  const results = new Map<string, ReturnType<typeof evaluateHand>>();
  for (const p of contenders) {
    const result = evaluatePlayerHandForVariant(p, board, state.gameType ?? 'short_deck');
    results.set(p.id, result);
    p.handResult = result;
    const labels = p.runItTwiceHandNamesZh ? [...p.runItTwiceHandNamesZh] : ['', ''];
    labels[runIndex] = formatHandLabelEnDetailed(result);
    p.runItTwiceHandNamesZh = [labels[0], labels[1]];
    p.revealedMask = forceFullReveal ? fullRevealMaskForCount(p.holeCards.length) : 0;
    p.revealedCount = forceFullReveal ? p.holeCards.length : 0;
  }

  let best = results.get(contenders[0].id)!;
  for (const p of contenders) {
    const r = results.get(p.id)!;
    if (compareHands(r, best) > 0) best = r;
  }

  const runWinners = contenders
    .filter(p => compareHands(results.get(p.id)!, best) === 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const runWinnerInfos = runWinners.map((w) => ({
    playerId: w.id,
    name: w.name,
    chipsWon: 0,
    handName: results.get(w.id)!.name,
    handNameZh: results.get(w.id)!.nameZh,
    holeCards: w.holeCards,
  }));

  if (state.runItTwice) {
    if (!state.runItTwice.summary) state.runItTwice.summary = [];
    for (const w of runWinners) {
      state.runItTwice.summary.push({
        name: w.name,
        handLabel: formatHandLabelEnDetailed(results.get(w.id)!),
      });
    }
    const bestLabel = runWinners.length > 0 ? formatHandLabelEnDetailed(results.get(runWinners[0].id)!) : '';
    const line = { playerIds: runWinners.map((w) => w.id), names: runWinners.map((w) => w.name), handLabel: bestLabel };
    if (!state.runItTwice.runResults) state.runItTwice.runResults = [];
    if (state.runItTwice.runResults.length <= runIndex) state.runItTwice.runResults.push(line);
    else state.runItTwice.runResults[runIndex] = line;
  }

  return runWinnerInfos;
}

function shouldOpenRunItTwiceOffer(state: FullGameState): boolean {
  if (state.runItTwice?.status === 'pending') return false;
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length !== 2) return false;
  if (!remaining.some(p => p.allIn)) return false;
  if ((state.gameType ?? 'short_deck') === 'crazy_pineapple' && remaining.some(p => p.holeCards.length > 2)) return false;
  if (state.communityCards.length >= 5) return false;
  return state.playersToAct.length === 0;
}

function nextStage(stage: GameStage, gameType: GameType): GameStage {
  const stages: GameStage[] = gameType === 'crazy_pineapple'
    ? ['preflop', 'flop', 'flop_discard', 'turn', 'river', 'showdown']
    : ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const idx = stages.indexOf(stage);
  return stages[idx + 1] || 'showdown';
}

function dealStreetToBoard(state: FullGameState, board: Card[], street: GameStage): void {
  if (street === 'flop') {
    board.push(dealCard(state), dealCard(state), dealCard(state));
  } else if (street === 'turn' || street === 'river') {
    board.push(dealCard(state));
  }
}

function splitPotByBestHand(
  amount: number,
  eligible: PlayerState[],
  boardResults: Map<string, ReturnType<typeof evaluateHand>>,
  winnings: Map<string, number>
): void {
  if (amount <= 0 || eligible.length === 0) return;
  if (eligible.length === 1) {
    const only = eligible[0];
    winnings.set(only.id, (winnings.get(only.id) || 0) + amount);
    return;
  }

  let best = boardResults.get(eligible[0].id)!;
  for (const p of eligible) {
    const r = boardResults.get(p.id)!;
    if (compareHands(r, best) > 0) best = r;
  }
  const winners = eligible
    .filter(p => compareHands(boardResults.get(p.id)!, best) === 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const share = Math.floor(amount / winners.length);
  let remainder = amount - share * winners.length;
  for (const w of winners) {
    const add = share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    winnings.set(w.id, (winnings.get(w.id) || 0) + add);
  }
}

// If the largest bet is uncalled, refund the unmatched portion immediately.
function settleUncalledOverbet(state: FullGameState): void {
  const contenders = state.players.filter((p) => !p.folded);
  if (contenders.length < 2) return;
  if (state.playersToAct.length > 0) return;

  const sorted = [...contenders].sort((a, b) => b.bet - a.bet);
  const top = sorted[0];
  const second = sorted[1];
  if (!top || !second) return;
  if (top.bet <= second.bet) return;
  if (sorted.filter((p) => p.bet === top.bet).length > 1) return;

  const refund = top.bet - second.bet;
  top.bet -= refund;
  top.totalBet -= refund;
  top.chips += refund;
  if (top.chips > 0) top.allIn = false;
  state.pot -= refund;
  state.currentBet = Math.max(...contenders.map((p) => p.bet));
}

// Initialize a brand new hand
export function initHand(
  players: Array<{ id: string; name: string; color: string; chips: number; isBot: boolean; isConnected: boolean }>,
  settings: RoomSettings,
  dealerIndex: number,
  handNumber: number,
  roomId: string
): FullGameState {
  const deck = createDeck(settings.gameType ?? 'short_deck');
  const activePlayers = players.filter(p => p.chips > 0 && p.isConnected);
  const bombEnabled = !!settings.bombPotEnabled;
  const bombInterval = Math.max(1, Math.floor(settings.bombPotInterval || 1));
  const bombAmount = Math.max(1, Math.floor(settings.bombPotAmount || settings.bigBlind || 1));
  const isBombPotHand = bombEnabled && (handNumber % bombInterval === 0);
  const handsUntilNextBomb = bombEnabled
    ? (isBombPotHand ? 0 : (bombInterval - (handNumber % bombInterval)))
    : -1;

  const playerStates: PlayerState[] = activePlayers.map((p, i) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    chips: p.chips,
    bet: 0,
    totalBet: 0,
    holeCards: [],
    folded: false,
    allIn: false,
    isBot: p.isBot,
    isConnected: p.isConnected,
    seatIndex: i,
    revealedMask: 0,
    revealedCount: 0,
  }));

  const n = activePlayers.length;
  const safeDealer = dealerIndex % n;
  // Heads-up special case: dealer posts SB and acts first preflop
  const headsUp = n === 2;
  const sbIdx = headsUp ? safeDealer : (safeDealer + 1) % n;
  const bbIdx = headsUp ? ((safeDealer + 1) % n) : ((safeDealer + 2) % n);

  const state: FullGameState = {
    roomId,
    gameType: settings.gameType ?? 'short_deck',
    bombPot: {
      enabled: bombEnabled,
      active: isBombPotHand,
      amount: bombAmount,
      interval: bombInterval,
      handsUntilNext: handsUntilNextBomb,
    },
    handNumber,
    stage: isBombPotHand ? 'flop' : 'preflop',
    communityCards: [],
    deck,
    deckIndex: 0,
    pot: 0,
    currentBet: isBombPotHand ? 0 : settings.bigBlind,
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    dealerIndex: safeDealer,
    smallBlindIndex: sbIdx,
    bigBlindIndex: bbIdx,
    currentPlayerIndex: headsUp ? sbIdx : ((bbIdx + 1) % n),
    lastRaiseIndex: isBombPotHand ? -1 : bbIdx,
    lastRaiseSize: settings.bigBlind,
    runItTwice: undefined,
    players: playerStates,
    actionLog: [],
    playersToAct: [],
  };

  const holeCardCount = state.gameType === 'omaha' ? 4 : state.gameType === 'crazy_pineapple' ? 3 : 2;
  for (let i = 0; i < holeCardCount; i++) {
    for (const p of state.players) {
      p.holeCards.push(dealCard(state));
    }
  }

  if (isBombPotHand) {
    for (const p of state.players) {
      const ante = Math.min(bombAmount, p.chips);
      p.chips -= ante;
      p.bet = ante;
      p.totalBet = ante;
      state.pot += ante;
      if (p.chips === 0) p.allIn = true;
      state.actionLog.push({
        playerId: p.id,
        playerName: p.name,
        action: 'bomb_ante',
        amount: ante,
        timestamp: Date.now(),
      });
    }
    // Skip preflop and deal flop immediately.
    state.communityCards.push(dealCard(state), dealCard(state), dealCard(state));
    for (const p of state.players) p.bet = 0;
    state.currentBet = 0;
    state.lastRaiseIndex = -1;
    state.lastRaiseSize = state.bigBlind;
    if (countLiveNotAllIn(state) <= 1) {
      state.playersToAct = [];
      state.currentPlayerIndex = -1;
    } else {
      // Bomb pot action starts from SB seat.
      const nPlayers = state.players.length;
      let first = state.smallBlindIndex;
      let tries = 0;
      while (tries < nPlayers && (state.players[first].folded || state.players[first].allIn)) {
        first = (first + 1) % nPlayers;
        tries++;
      }
      state.currentPlayerIndex = first;
      setPlayersToActAll(state);
    }
  } else {
    // Post small blind
    const sb = state.players[sbIdx];
    const sbAmt = Math.min(settings.smallBlind, sb.chips);
    sb.chips -= sbAmt;
    sb.bet = sbAmt;
    sb.totalBet = sbAmt;
    state.pot += sbAmt;
    if (sb.chips === 0) sb.allIn = true;
    state.actionLog.push({
      playerId: sb.id, playerName: sb.name,
      action: 'blind_small', amount: sbAmt, timestamp: Date.now(),
    });

    // Post big blind
    const bb = state.players[bbIdx];
    const bbAmt = Math.min(settings.bigBlind, bb.chips);
    bb.chips -= bbAmt;
    bb.bet = bbAmt;
    bb.totalBet = bbAmt;
    state.pot += bbAmt;
    if (bb.chips === 0) bb.allIn = true;
    state.actionLog.push({
      playerId: bb.id, playerName: bb.name,
      action: 'blind_big', amount: bbAmt, timestamp: Date.now(),
    });

    // Everyone owes one preflop action, including BB (BB can check/raise when unopened)
    setPlayersToActAll(state);
  }

  return state;
}

// Apply a player action, returns new state
export function applyAction(
  state: FullGameState,
  playerId: string,
  action: ActionType,
  raiseAmount?: number
): { state: FullGameState; error?: string } {
  const idx = state.players.findIndex(p => p.id === playerId);
  if (idx === -1) return { state, error: 'Player not found' };
  if (idx !== state.currentPlayerIndex) return { state, error: 'Not your turn' };

  const player = state.players[idx];
  if (state.stage === 'flop_discard') {
    if (player.folded) return { state, error: 'Player cannot act' };
    // All-in players still must discard one card in Crazy Pineapple.
    if (action !== 'discard') return { state, error: 'Must discard one card before turn' };
    if (!state.playersToAct.includes(player.id)) return { state, error: 'Not your turn' };
    if (player.holeCards.length <= 2) return { state, error: 'No card to discard' };
    const discardIdx = Math.max(0, Math.min(player.holeCards.length - 1, Math.floor(raiseAmount ?? (player.holeCards.length - 1))));
    player.holeCards.splice(discardIdx, 1);
    removePlayerToAct(state, player.id);
    state.actionLog.push({
      playerId: player.id,
      playerName: player.name,
      action: 'discard',
      amount: discardIdx + 1,
      timestamp: Date.now(),
    });
    if (state.playersToAct.length === 0) {
      advanceStage(state);
    } else {
      moveToNextPlayer(state);
    }
    return { state };
  }

  if (player.folded || player.allIn) return { state, error: 'Player cannot act' };

  const logEntry: ActionLogEntry = {
    playerId: player.id,
    playerName: player.name,
    action,
    timestamp: Date.now(),
  };

  switch (action) {
    case 'fold':
      player.folded = true;
      removePlayerToAct(state, player.id);
      break;

    case 'check': {
      if (state.currentBet > player.bet) {
        return { state, error: 'Cannot check — there is a bet to call' };
      }
      removePlayerToAct(state, player.id);
      break;
    }

    case 'call': {
      const callAmt = Math.min(state.currentBet - player.bet, player.chips);
      player.chips -= callAmt;
      player.bet += callAmt;
      player.totalBet += callAmt;
      state.pot += callAmt;
      // Use unified "to" amount for UI bubbles (instead of delta)
      logEntry.amount = player.bet;
      if (player.chips === 0) player.allIn = true;
      removePlayerToAct(state, player.id);
      break;
    }

    case 'raise': {
      const maxTotal = player.chips + player.bet;
      const minRaiseTo = getMinRaiseTo(state);
      if (maxTotal <= state.currentBet) {
        return { state, error: 'No chips available to raise' };
      }
      if (maxTotal < minRaiseTo) {
        return { state, error: 'Raise too small (all-in only)' };
      }
      const totalRaise = Math.max(
        minRaiseTo,
        Math.min(raiseAmount ?? minRaiseTo, maxTotal)
      );
      const addAmt = totalRaise - player.bet;
      if (addAmt > player.chips) {
        return { state, error: 'Insufficient chips' };
      }
      const previousBet = state.currentBet;
      player.chips -= addAmt;
      player.bet = totalRaise;
      player.totalBet += addAmt;
      state.pot += addAmt;
      state.currentBet = totalRaise;
      state.lastRaiseIndex = idx;
      state.lastRaiseSize = totalRaise - previousBet;
      logEntry.amount = totalRaise;
      if (player.chips === 0) player.allIn = true;
      // Full raise re-opens action for everyone else still able to act
      setPlayersToActAll(state, player.id);
      break;
    }

    case 'allin': {
      const allinAmt = player.chips;
      const previousBet = state.currentBet;
      const newTotal = player.bet + allinAmt;
      if (newTotal > state.currentBet) {
        state.currentBet = newTotal;
        state.lastRaiseIndex = idx;
        const raiseSize = newTotal - previousBet;
        const minFullRaise = state.lastRaiseSize ?? state.bigBlind;
        const isFullRaise = raiseSize >= minFullRaise;
        if (isFullRaise) {
          state.lastRaiseSize = raiseSize;
          setPlayersToActAll(state, player.id);
        } else {
          // Short all-in raise: can force calls but may not fully re-open raising
          removePlayerToAct(state, player.id);
          ensurePlayersWhoOweCall(state);
        }
      } else {
        removePlayerToAct(state, player.id);
      }
      player.bet = newTotal;
      player.totalBet += allinAmt;
      state.pot += allinAmt;
      player.chips = 0;
      player.allIn = true;
      // Use unified "to" amount for UI bubbles (instead of delta)
      logEntry.amount = player.bet;
      break;
    }
  }

  state.actionLog.push(logEntry);

  // Check if only one player remains
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length === 1) {
    return { state: endHandByFolds(state, remaining) };
  }

  settleUncalledOverbet(state);

  // Heads-up all-in: open run-it-twice decision BEFORE dealing next street.
  if (shouldOpenRunItTwiceOffer(state)) {
    const votes: Record<string, boolean | null> = {};
    for (const p of remaining) votes[p.id] = null;
    state.runItTwice = {
      status: 'pending',
      votes,
      boards: undefined,
    };
    state.currentPlayerIndex = -1;
    return { state };
  }

  // Advance to next player / next stage
  advanceGame(state);
  if (shouldOpenRunItTwiceOffer(state)) {
    const votes: Record<string, boolean | null> = {};
    for (const p of state.players.filter(x => !x.folded)) votes[p.id] = null;
    state.runItTwice = { status: 'pending', votes, boards: undefined };
    state.currentPlayerIndex = -1;
  }
  return { state };
}

function advanceGame(state: FullGameState): void {
  if (isBettingRoundComplete(state)) {
    advanceStage(state);
  } else {
    moveToNextPlayer(state);
  }
}

function isBettingRoundComplete(state: FullGameState): boolean {
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length <= 1) return true;
  if (state.playersToAct.length > 0) return false;

  const active = remaining.filter(p => !p.allIn);
  if (active.length === 0) return true;
  return active.every(p => p.bet === state.currentBet);
}

function moveToNextPlayer(state: FullGameState): void {
  const n = state.players.length;
  let next = (state.currentPlayerIndex + 1) % n;
  let tries = 0;
  while (tries < n) {
    const p = state.players[next];
    // In Crazy Pineapple flop discard, all-in players still must discard one card.
    if (!p.folded && state.playersToAct.includes(p.id) && (state.stage === 'flop_discard' || !p.allIn)) break;
    next = (next + 1) % n;
    tries++;
  }
  state.currentPlayerIndex = next;
}

function enterFlopDiscardStage(state: FullGameState): boolean {
  const discardActors = state.players.filter((p) => !p.folded && p.holeCards.length > 2);
  if (discardActors.length === 0) return false;
  state.stage = 'flop_discard';
  state.playersToAct = discardActors.map((p) => p.id);
  const firstDiscard = discardActors.sort((a, b) => a.seatIndex - b.seatIndex)[0];
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === firstDiscard.id);
  return true;
}

function advanceStage(state: FullGameState): void {
  // Reset per-round bets
  state.players.forEach(p => { p.bet = 0; });
  state.currentBet = 0;
  state.lastRaiseIndex = -1;
  state.lastRaiseSize = state.bigBlind;

  const stages: GameStage[] = (state.gameType ?? 'short_deck') === 'crazy_pineapple'
    ? ['preflop', 'flop', 'flop_discard', 'turn', 'river', 'showdown']
    : ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const currentIdx = stages.indexOf(state.stage);
  state.stage = stages[currentIdx + 1] || 'showdown';

  switch (state.stage) {
    case 'flop':
      state.communityCards.push(dealCard(state), dealCard(state), dealCard(state));
      break;
    case 'flop_discard': {
      if (!enterFlopDiscardStage(state)) {
        advanceStage(state);
      }
      return;
    }
    case 'turn':
      state.communityCards.push(dealCard(state));
      break;
    case 'river':
      state.communityCards.push(dealCard(state));
      break;
    case 'showdown':
      resolveShowdown(state);
      return;
  }

  // Crazy Pineapple: if we're in an auto-runout situation and players still have 3 hole cards,
  // jump into the discard gate immediately after dealing the flop.
  if ((state.gameType ?? 'short_deck') === 'crazy_pineapple' && state.stage === 'flop' && countLiveNotAllIn(state) <= 1) {
    if (enterFlopDiscardStage(state)) return;
  }

  // If one or fewer players can still act (others are all-in/folded),
  // do not open a new betting round. This allows automatic runout.
  if (countLiveNotAllIn(state) <= 1) {
    state.playersToAct = [];
    state.currentPlayerIndex = -1;
    return;
  }

  // Set first actor (first non-folded after dealer)
  const n = state.players.length;
  let first = (state.dealerIndex + 1) % n;
  let tries = 0;
  while (tries < n && (state.players[first].folded || state.players[first].allIn)) {
    first = (first + 1) % n;
    tries++;
  }
  state.currentPlayerIndex = first;
  setPlayersToActAll(state);
}

function resolveShowdown(state: FullGameState): void {
  const contenders = state.players.filter(p => !p.folded);
  const hasAllInContender = contenders.some(p => p.allIn);
  const forceFullReveal = hasAllInContender || (state.gameType === 'omaha' || state.gameType === 'crazy_pineapple');

  for (const p of contenders) {
    p.revealedMask = forceFullReveal ? fullRevealMaskForCount(p.holeCards.length) : 0;
    p.revealedCount = forceFullReveal ? p.holeCards.length : 0;
  }

  // Evaluate hands
  for (const p of contenders) {
    p.handResult = evaluatePlayerHandForVariant(p, state.communityCards, state.gameType ?? 'short_deck');
  }

  // Build side pots from total contributions.
  const allPlayers = state.players.filter(p => p.totalBet > 0);
  const levels = Array.from(new Set(allPlayers.map(p => p.totalBet))).sort((a, b) => a - b);
  let prev = 0;
  const winnings = new Map<string, number>();

  for (const level of levels) {
    const contributors = allPlayers.filter(p => p.totalBet >= level);
    const potAmount = (level - prev) * contributors.length;
    prev = level;
    if (potAmount <= 0) continue;

    const eligible = contributors.filter(p => !p.folded);
    if (eligible.length === 0) continue;

    let best = eligible[0].handResult!;
    for (const p of eligible) {
      if (compareHands(p.handResult!, best) > 0) best = p.handResult!;
    }
    const potWinners = eligible.filter(p => compareHands(p.handResult!, best) === 0)
      .sort((a, b) => a.seatIndex - b.seatIndex);
    const share = Math.floor(potAmount / potWinners.length);
    let remainder = potAmount - share * potWinners.length;

    for (const w of potWinners) {
      const add = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      w.chips += add;
      winnings.set(w.id, (winnings.get(w.id) || 0) + add);
    }
  }

  const winnerInfos: WinnerInfo[] = contenders
    .filter(p => (winnings.get(p.id) || 0) > 0)
    .map((w) => {
      w.revealedMask = fullRevealMaskForCount(w.holeCards.length);
      w.revealedCount = w.holeCards.length;
      return {
        playerId: w.id,
        name: w.name,
        chipsWon: winnings.get(w.id)!,
        handName: w.handResult!.name,
        handNameZh: w.handResult!.nameZh,
        holeCards: w.holeCards,
      };
    });

  state.winners = winnerInfos.sort((a, b) => b.chipsWon - a.chipsWon);
  state.stage = 'showdown';
}

function resolveShowdownRunItTwice(state: FullGameState): void {
  const contenders = state.players.filter(p => !p.folded);
  const hasAllInContender = contenders.some(p => p.allIn);
  const forceFullReveal = hasAllInContender || (state.gameType === 'omaha' || state.gameType === 'crazy_pineapple');
  const boards = state.runItTwice?.boards;
  if (!boards || boards.length !== 2) {
    resolveShowdown(state);
    return;
  }

  const [board1, board2] = boards;
  const results1 = new Map<string, ReturnType<typeof evaluateHand>>();
  const results2 = new Map<string, ReturnType<typeof evaluateHand>>();

  for (const p of contenders) {
    const r1 = evaluatePlayerHandForVariant(p, board1, state.gameType ?? 'short_deck');
    const r2 = evaluatePlayerHandForVariant(p, board2, state.gameType ?? 'short_deck');
    results1.set(p.id, r1);
    results2.set(p.id, r2);
    p.handResult = r1;
    p.runItTwiceHandNamesZh = [formatHandLabelEnDetailed(r1), formatHandLabelEnDetailed(r2)];
    p.revealedMask = forceFullReveal ? fullRevealMaskForCount(p.holeCards.length) : 0;
    p.revealedCount = forceFullReveal ? p.holeCards.length : 0;
  }
  const allPlayers = state.players.filter(p => p.totalBet > 0);
  const levels = Array.from(new Set(allPlayers.map(p => p.totalBet))).sort((a, b) => a - b);
  let prev = 0;
  const winnings = new Map<string, number>();

  for (const level of levels) {
    const contributors = allPlayers.filter(p => p.totalBet >= level);
    const potAmount = (level - prev) * contributors.length;
    prev = level;
    if (potAmount <= 0) continue;

    const eligible = contributors.filter(p => !p.folded);
    if (eligible.length === 0) continue;

    if (eligible.length === 1) {
      const only = eligible[0];
      winnings.set(only.id, (winnings.get(only.id) || 0) + potAmount);
      continue;
    }

    const run1Amount = Math.floor(potAmount / 2);
    const run2Amount = potAmount - run1Amount;
    splitPotByBestHand(run1Amount, eligible, results1, winnings);
    splitPotByBestHand(run2Amount, eligible, results2, winnings);
  }

  const winnerInfos: WinnerInfo[] = contenders
    .filter(p => (winnings.get(p.id) || 0) > 0)
    .map((w) => {
      const chipsWon = winnings.get(w.id)!;
      w.chips += chipsWon;
      w.revealedMask = fullRevealMaskForCount(w.holeCards.length);
      w.revealedCount = w.holeCards.length;
      return {
        playerId: w.id,
        name: w.name,
        chipsWon,
        handName: 'Run It Twice',
        handNameZh: '跑两次',
        holeCards: w.holeCards,
      };
    });

  state.winners = winnerInfos.sort((a, b) => b.chipsWon - a.chipsWon);
  state.communityCards = board2.slice(0, 5);
  state.stage = 'showdown';
}

function endHandByFolds(state: FullGameState, remaining: PlayerState[]): FullGameState {
  const winner = remaining[0];
  winner.chips += state.pot;
  // Fold-win does not require a forced showdown; winner may choose whether to reveal.
  winner.revealedMask = 0;
  winner.revealedCount = 0;
  state.winners = [{
    playerId: winner.id,
    name: winner.name,
    chipsWon: state.pot,
    handName: 'Others Folded',
    handNameZh: '其他人弃牌',
    holeCards: winner.holeCards,
  }];
  state.stage = 'showdown';
  return state;
}

// Strips hole cards from state for sending to a specific player
export function sanitizeStateFor(state: FullGameState, viewerId: string): GameState {
  const { deck, deckIndex, playersToAct, ...publicState } = state;
  return {
    ...publicState,
    players: state.players.map(p => ({
      ...p,
      holeCardCount: p.holeCards.length,
      publicHoleCards: p.id === viewerId ? undefined : publicHoleCardsByIndex(p.holeCards, p.revealedMask ?? 0),
      holeCards: p.id === viewerId ? p.holeCards : publicHoleCardsForMask(p.holeCards, p.revealedMask ?? 0),
      revealedCount: (() => {
        const full = fullRevealMaskForCount(p.holeCards.length);
        const m = p.revealedMask ?? 0;
        return m === full ? p.holeCards.length : bitCount(m);
      })(),
    })),
  };
}

// Force-deal exactly one street ahead (used by delayed all-in runout flow).
export function advanceRunoutStreet(state: FullGameState): FullGameState {
  if (state.runItTwice?.status === 'agreed') {
    if (!state.runItTwice.boards) {
      state.runItTwice.boards = [
        [...state.communityCards],
        [...state.communityCards],
      ];
    }
    if (!state.runItTwice.phase) {
      state.runItTwice.phase = 'run1';
      state.runItTwice.baseStage = state.stage;
      state.runItTwice.summary = [];
      state.runItTwice.runResults = [];
      state.currentPlayerIndex = -1;
    }

    if (state.runItTwice.phase === 'run1_showdown') {
      state.runItTwice.phase = 'run2';
      state.stage = state.runItTwice.baseStage ?? 'preflop';
      state.communityCards = state.runItTwice.boards[1].slice(0, communityCountForStage(state.stage));
      state.winners = [];
      state.currentPlayerIndex = -1;
      return state;
    }
    if (state.runItTwice.phase === 'run2_showdown') {
      resolveShowdownRunItTwice(state);
      state.runItTwice.phase = 'final';
      state.currentPlayerIndex = -1;
      return state;
    }
    if (state.runItTwice.phase === 'final') return state;

    state.players.forEach(p => { p.bet = 0; });
    state.currentBet = 0;
    state.lastRaiseIndex = -1;
    state.lastRaiseSize = state.bigBlind;
    const currentRunIdx = state.runItTwice.phase === 'run2' ? 1 : 0;
    const board = state.runItTwice.boards[currentRunIdx];
    const toStage = nextStage(state.stage, state.gameType ?? 'short_deck');
    if (toStage === 'flop_discard') {
      state.communityCards = board.slice();
      // Crazy Pineapple: pause runout for player-selected discard (even if all-in).
      if (!enterFlopDiscardStage(state)) {
        // No one needs to discard; continue runout immediately next tick.
        state.stage = 'flop_discard';
        state.playersToAct = [];
        state.currentPlayerIndex = -1;
      }
      return state;
    }
    if (toStage === 'showdown') {
      state.stage = 'showdown';
      state.communityCards = board.slice(0, 5);
      state.winners = evaluateSingleRunWinners(state, board, currentRunIdx as 0 | 1);
      state.runItTwice.phase = currentRunIdx === 0 ? 'run1_showdown' : 'run2_showdown';
      state.currentPlayerIndex = -1;
      return state;
    }

    state.stage = toStage;
    dealStreetToBoard(state, board, toStage);
    state.communityCards = board.slice();
    state.currentPlayerIndex = -1;
    return state;
  }

  if (state.stage === 'showdown') return state;
  advanceStage(state);
  return state;
}
