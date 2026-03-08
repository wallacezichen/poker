import { FullGameState } from './engine';
import { evaluateHand, HAND_RANK } from './handEvaluator';
import { ActionType } from '../types/poker';

// ============================================================
// Bot AI - Simple but reasonable short deck poker bot
// ============================================================

interface BotDecision {
  action: ActionType;
  amount?: number;
}

export function decideBotAction(
  state: FullGameState,
  botId: string
): BotDecision {
  const idx = state.players.findIndex(p => p.id === botId);
  if (idx === -1 || idx !== state.currentPlayerIndex) {
    return { action: 'check' };
  }

  const bot = state.players[idx];
  const canCheck = state.currentBet <= bot.bet;
  const callAmt = Math.min(state.currentBet - bot.bet, bot.chips);
  const potOdds = callAmt / (state.pot + callAmt);

  // Evaluate hand strength
  const allCards = [...bot.holeCards, ...state.communityCards];
  const handResult = evaluateHand(allCards);
  const strength = handResult.rank; // 0-9

  // Normalize to 0-1 scale (max rank is 9)
  const normalizedStrength = strength / 9;

  // Factor in stage (be more aggressive early)
  const stageMultiplier = {
    preflop: 0.9,
    flop: 1.0,
    turn: 1.1,
    river: 1.2,
    showdown: 1.0,
    waiting: 1.0,
  }[state.stage] || 1.0;

  const effectiveStrength = Math.min(1, normalizedStrength * stageMultiplier);

  // Add randomness for unpredictability
  const rand = Math.random();
  const bluffChance = 0.08; // 8% bluff rate

  // Pre-flop hole card assessment (if no community cards yet)
  let preflopBonus = 0;
  if (state.stage === 'preflop' && allCards.length === 2) {
    const r1 = allCards[0].rank;
    const r2 = allCards[1].rank;
    const suited = allCards[0].suit === allCards[1].suit;
    const isPair = r1 === r2;
    const hasAce = r1 === 'A' || r2 === 'A';
    const hasKing = r1 === 'K' || r2 === 'K';

    if (isPair) preflopBonus = 0.4;
    else if (hasAce && suited) preflopBonus = 0.3;
    else if (hasAce) preflopBonus = 0.2;
    else if (hasKing && suited) preflopBonus = 0.15;
    else if (suited) preflopBonus = 0.1;
  }

  const finalStrength = Math.min(1, effectiveStrength + preflopBonus);

  // Decision logic
  const shouldBluff = rand < bluffChance;

  if (shouldBluff) {
    // Bluff: raise with weak hand
    if (canCheck) {
      return makeBet(bot.chips, state.pot, 0.5);
    } else if (callAmt <= bot.chips * 0.15) {
      // Cheap call then bluff next round
      return { action: 'call' };
    }
    return { action: 'fold' };
  }

  if (finalStrength >= 0.7) {
    // Strong hand: raise/bet aggressively
    if (bot.chips <= callAmt * 2) {
      return { action: 'allin' };
    }
    if (canCheck) {
      return rand < 0.8 ? makeBet(bot.chips, state.pot, finalStrength) : { action: 'check' };
    }
    return rand < 0.7
      ? makeRaise(bot, state, finalStrength)
      : { action: 'call' };
  }

  if (finalStrength >= 0.4) {
    // Medium hand: call or small raise
    if (canCheck) {
      return rand < 0.4 ? makeBet(bot.chips, state.pot, 0.3) : { action: 'check' };
    }
    if (potOdds < 0.25) {
      return rand < 0.6 ? { action: 'call' } : { action: 'fold' };
    }
    return { action: 'fold' };
  }

  // Weak hand
  if (canCheck) return { action: 'check' };
  if (potOdds < 0.15 && rand < 0.3) return { action: 'call' };
  return { action: 'fold' };
}

function makeBet(chips: number, pot: number, strength: number): BotDecision {
  const betSize = Math.floor(pot * (0.5 + strength * 0.5));
  const amount = Math.min(betSize, chips);
  if (amount === chips) return { action: 'allin' };
  return { action: 'raise', amount };
}

function makeRaise(
  bot: { chips: number; bet: number },
  state: FullGameState,
  strength: number
): BotDecision {
  const minRaise = state.currentBet * 2;
  const maxRaise = bot.chips + bot.bet;
  const raiseSize = Math.floor(
    minRaise + (maxRaise - minRaise) * (strength - 0.5)
  );
  const amount = Math.min(Math.max(minRaise, raiseSize), maxRaise);
  if (amount >= maxRaise) return { action: 'allin' };
  return { action: 'raise', amount };
}

// Get bot's think delay (ms) — more variance for realism
export function getBotThinkTime(action: ActionType): number {
  const base: Record<ActionType, number> = {
    fold: 600,
    check: 400,
    call: 700,
    raise: 1200,
    allin: 900,
  };
  const variance = Math.random() * 800;
  return (base[action] || 800) + variance;
}
