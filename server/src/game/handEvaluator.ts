import { Card, HandResult, Rank, Suit } from '../types/poker';

// ============================================================
// Short Deck (6+) Hand Evaluator
// Key rule differences from standard poker:
//   1. Flush BEATS Full House
//   2. Three of a Kind BEATS Straight
//   3. A-6-7-8-9 is the lowest straight (A plays low)
// ============================================================

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
export const RANKS: Rank[] = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

const RANK_VALUES: Record<Rank, number> = {
  '6': 6, '7': 7, '8': 8, '9': 9,
  'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

// Short deck hand rankings (note: different order from standard)
export const HAND_RANK = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,  // beats straight in short deck!
  STRAIGHT: 4,
  FULL_HOUSE: 5,       // beats straight but loses to flush in short deck!
  FLUSH: 6,            // beats full house in short deck!
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const;

export const HAND_NAME_EN: Record<number, string> = {
  0: 'High Card', 1: 'One Pair', 2: 'Two Pair',
  3: 'Three of a Kind', 4: 'Straight', 5: 'Full House',
  6: 'Flush', 7: 'Four of a Kind', 8: 'Straight Flush', 9: 'Royal Flush',
};

export const HAND_NAME_ZH: Record<number, string> = {
  0: '高牌', 1: '一对', 2: '两对',
  3: '三条', 4: '顺子', 5: '葫芦',
  6: '同花', 7: '四条', 8: '同花顺', 9: '皇家同花顺',
};

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Check for short deck straight
// Returns { isStraight, high } where high is the highest card value
function checkStraight(vals: number[]): { isStraight: boolean; high: number } {
  const unique = [...new Set(vals)].sort((a, b) => a - b);

  // Check A-6-7-8-9 (wheel: A plays as 1 equivalent)
  const wheel = [6, 7, 8, 9, 14]; // 14 = A
  if (wheel.every(v => unique.includes(v))) {
    return { isStraight: true, high: 9 }; // 9-high straight (the wheel)
  }

  // Check normal straights (5 consecutive)
  for (let i = unique.length - 1; i >= 4; i--) {
    const top = unique[i];
    if (
      unique.includes(top - 1) &&
      unique.includes(top - 2) &&
      unique.includes(top - 3) &&
      unique.includes(top - 4)
    ) {
      return { isStraight: true, high: top };
    }
  }

  return { isStraight: false, high: 0 };
}

// Evaluate exactly 5 cards
function evaluate5(cards: Card[]): HandResult {
  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);
  const vals = ranks.map(r => rankValue(r)).sort((a, b) => b - a);

  const isFlush = new Set(suits).size === 1;
  const { isStraight, high: straightHigh } = checkStraight(vals);

  // Count each rank
  const rankCount: Record<string, number> = {};
  for (const r of ranks) rankCount[r] = (rankCount[r] || 0) + 1;

  // Sort by count desc, then rank value desc (for consistent tie-break vectors).
  const groups = Object.entries(rankCount)
    .map(([r, c]) => ({ val: rankValue(r as Rank), count: c }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.val - a.val;
    });

  const counts = groups.map(g => g.count);
  const pairVals = groups.filter(g => g.count === 2).map(g => g.val).sort((a, b) => b - a);
  const singleVals = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a);

  if (isFlush && isStraight) {
    const r = straightHigh === 14 ? HAND_RANK.ROYAL_FLUSH : HAND_RANK.STRAIGHT_FLUSH;
    return { rank: r, name: HAND_NAME_EN[r], nameZh: HAND_NAME_ZH[r], tiebreak: [straightHigh] };
  }
  if (counts[0] === 4) {
    const quadVal = groups.find(g => g.count === 4)!.val;
    const kicker = singleVals[0] ?? 0;
    return { rank: HAND_RANK.FOUR_OF_A_KIND, name: HAND_NAME_EN[7], nameZh: HAND_NAME_ZH[7], tiebreak: [quadVal, kicker] };
  }
  // Short deck: Flush > Full House
  if (isFlush) {
    return { rank: HAND_RANK.FLUSH, name: HAND_NAME_EN[6], nameZh: HAND_NAME_ZH[6], tiebreak: vals };
  }
  if (counts[0] === 3 && counts[1] === 2) {
    const tripVal = groups.find(g => g.count === 3)!.val;
    const pairVal = groups.find(g => g.count === 2)!.val;
    return { rank: HAND_RANK.FULL_HOUSE, name: HAND_NAME_EN[5], nameZh: HAND_NAME_ZH[5], tiebreak: [tripVal, pairVal] };
  }
  // Short deck: Three of a Kind > Straight
  if (counts[0] === 3) {
    const tripVal = groups.find(g => g.count === 3)!.val;
    return { rank: HAND_RANK.THREE_OF_A_KIND, name: HAND_NAME_EN[3], nameZh: HAND_NAME_ZH[3], tiebreak: [tripVal, ...singleVals] };
  }
  if (isStraight) {
    return { rank: HAND_RANK.STRAIGHT, name: HAND_NAME_EN[4], nameZh: HAND_NAME_ZH[4], tiebreak: [straightHigh] };
  }
  if (counts[0] === 2 && counts[1] === 2) {
    const kicker = singleVals[0] ?? 0;
    return { rank: HAND_RANK.TWO_PAIR, name: HAND_NAME_EN[2], nameZh: HAND_NAME_ZH[2], tiebreak: [pairVals[0], pairVals[1], kicker] };
  }
  if (counts[0] === 2) {
    return { rank: HAND_RANK.ONE_PAIR, name: HAND_NAME_EN[1], nameZh: HAND_NAME_ZH[1], tiebreak: [pairVals[0], ...singleVals] };
  }
  return { rank: HAND_RANK.HIGH_CARD, name: HAND_NAME_EN[0], nameZh: HAND_NAME_ZH[0], tiebreak: vals };
}

// Get all C(n,5) combinations
function combinations(arr: Card[], k: number): Card[][] {
  if (k === arr.length) return [arr];
  if (k === 1) return arr.map(x => [x]);
  const result: Card[][] = [];
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1);
    for (const combo of rest) result.push([arr[i], ...combo]);
  }
  return result;
}

// Compare two hands: positive = a wins, negative = b wins, 0 = tie
export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Evaluate best 5-card hand from 5-7 cards
export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) {
    return { rank: -1, name: 'Invalid', nameZh: '无效', tiebreak: [] };
  }
  if (cards.length === 5) return evaluate5(cards);

  let best: HandResult | null = null;
  let bestCombos: Card[][] = [];
  for (const combo of combinations(cards, 5)) {
    const result = evaluate5(combo);
    if (!best || compareHands(result, best) > 0) {
      best = { ...result, cards: combo };
      bestCombos = [combo];
    } else if (best && compareHands(result, best) === 0) {
      bestCombos.push(combo);
    }
  }
  const seen = new Set<string>();
  const mergedBestCards: Card[] = [];
  for (const combo of bestCombos) {
    for (const c of combo) {
      const key = `${c.rank}${c.suit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mergedBestCards.push(c);
    }
  }
  return { ...best!, cards: mergedBestCards };
}
