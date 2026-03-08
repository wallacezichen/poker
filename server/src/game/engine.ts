import { v4 as uuidv4 } from 'uuid';
import {
  Card, GameState, PlayerState, ActionType,
  WinnerInfo, ActionLogEntry, RoomSettings, GameStage
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
    state.deck = createDeck();
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

function getMinRaiseTo(state: FullGameState): number {
  const lastFullRaiseSize = state.lastRaiseSize ?? state.bigBlind;
  return state.currentBet + lastFullRaiseSize;
}

// Initialize a brand new hand
export function initHand(
  players: Array<{ id: string; name: string; color: string; chips: number; isBot: boolean; isConnected: boolean }>,
  settings: RoomSettings,
  dealerIndex: number,
  handNumber: number,
  roomId: string
): FullGameState {
  const deck = createDeck();
  const activePlayers = players.filter(p => p.chips > 0 && p.isConnected);

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
  }));

  const n = activePlayers.length;
  const safeDealer = dealerIndex % n;
  // Heads-up special case: dealer posts SB and acts first preflop
  const headsUp = n === 2;
  const sbIdx = headsUp ? safeDealer : (safeDealer + 1) % n;
  const bbIdx = headsUp ? ((safeDealer + 1) % n) : ((safeDealer + 2) % n);

  const state: FullGameState = {
    roomId,
    handNumber,
    stage: 'preflop',
    communityCards: [],
    deck,
    deckIndex: 0,
    pot: 0,
    currentBet: settings.bigBlind,
    smallBlind: settings.smallBlind,
    bigBlind: settings.bigBlind,
    dealerIndex: safeDealer,
    smallBlindIndex: sbIdx,
    bigBlindIndex: bbIdx,
    currentPlayerIndex: headsUp ? sbIdx : ((bbIdx + 1) % n),
    lastRaiseIndex: bbIdx,
    lastRaiseSize: settings.bigBlind,
    players: playerStates,
    actionLog: [],
    playersToAct: [],
  };

  // Deal 2 hole cards to each player
  for (let i = 0; i < 2; i++) {
    for (const p of state.players) {
      p.holeCards.push(dealCard(state));
    }
  }

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
      logEntry.amount = callAmt;
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
      logEntry.amount = allinAmt;
      break;
    }
  }

  state.actionLog.push(logEntry);

  // Check if only one player remains
  const remaining = state.players.filter(p => !p.folded);
  if (remaining.length === 1) {
    return { state: endHandByFolds(state, remaining) };
  }

  // Advance to next player / next stage
  advanceGame(state);
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
  const active = state.players.filter(p => !p.folded && !p.allIn);
  if (active.length <= 1) return true;
  const everyoneMatched = active.every(p => p.bet === state.currentBet);
  return everyoneMatched && state.playersToAct.length === 0;
}

function moveToNextPlayer(state: FullGameState): void {
  const n = state.players.length;
  let next = (state.currentPlayerIndex + 1) % n;
  let tries = 0;
  while (tries < n) {
    const p = state.players[next];
    if (!p.folded && !p.allIn && state.playersToAct.includes(p.id)) break;
    next = (next + 1) % n;
    tries++;
  }
  state.currentPlayerIndex = next;
}

function advanceStage(state: FullGameState): void {
  // Reset per-round bets
  state.players.forEach(p => { p.bet = 0; });
  state.currentBet = 0;
  state.lastRaiseIndex = -1;
  state.lastRaiseSize = state.bigBlind;

  const stages: GameStage[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const currentIdx = stages.indexOf(state.stage);
  state.stage = stages[currentIdx + 1] || 'showdown';

  switch (state.stage) {
    case 'flop':
      state.communityCards.push(dealCard(state), dealCard(state), dealCard(state));
      break;
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

  // Evaluate hands
  for (const p of contenders) {
    const allCards = [...p.holeCards, ...state.communityCards];
    p.handResult = evaluateHand(allCards);
  }

  // Find winner(s)
  let bestResult = contenders[0].handResult!;
  for (const p of contenders) {
    if (compareHands(p.handResult!, bestResult) > 0) {
      bestResult = p.handResult!;
    }
  }

  const winners = contenders.filter(p => compareHands(p.handResult!, bestResult) === 0);
  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot - share * winners.length;

  const winnerInfos: WinnerInfo[] = winners.map((w, i) => {
    const earned = share + (i === 0 ? remainder : 0);
    w.chips += earned;
    return {
      playerId: w.id,
      name: w.name,
      chipsWon: earned,
      handName: w.handResult!.name,
      handNameZh: w.handResult!.nameZh,
      holeCards: w.holeCards,
    };
  });

  state.winners = winnerInfos;
  state.stage = 'showdown';
}

function endHandByFolds(state: FullGameState, remaining: PlayerState[]): FullGameState {
  const winner = remaining[0];
  winner.chips += state.pot;
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
      holeCards: p.id === viewerId || state.stage === 'showdown' ? p.holeCards : [],
    })),
  };
}
