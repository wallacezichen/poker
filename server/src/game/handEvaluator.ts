import { Card, GameType, HandResult, Rank, Suit } from '../types/poker';

export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
export const SHORT_DECK_RANKS: Rank[] = ['6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const REGULAR_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

// Standard order is used as numeric baseline.
// In short deck, only Flush/Full House order changes.
export const HAND_RANK = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const;

export const HAND_NAME_EN: Record<number, string> = {
  0: 'High Card',
  1: 'One Pair',
  2: 'Two Pair',
  3: 'Three of a Kind',
  4: 'Straight',
  5: 'Flush',
  6: 'Full House',
  7: 'Four of a Kind',
  8: 'Straight Flush',
  9: 'Royal Flush',
};

export const HAND_NAME_ZH: Record<number, string> = {
  0: '高牌',
  1: '一对',
  2: '两对',
  3: '三条',
  4: '顺子',
  5: '同花',
  6: '葫芦',
  7: '四条',
  8: '同花顺',
  9: '皇家同花顺',
};

export function rankValue(rank: Rank): number {
  return RANK_VALUES[rank];
}

export function createDeck(gameType: GameType = 'short_deck'): Card[] {
  const deck: Card[] = [];
  const ranks = gameType === 'short_deck' ? SHORT_DECK_RANKS : REGULAR_RANKS;
  for (const suit of SUITS) {
    for (const rank of ranks) {
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

function checkStraight(vals: number[], gameType: GameType): { isStraight: boolean; high: number } {
  const unique = [...new Set(vals)].sort((a, b) => a - b);

  if (gameType === 'short_deck') {
    // A-6-7-8-9 is the lowest short deck straight.
    const wheel = [6, 7, 8, 9, 14];
    if (wheel.every(v => unique.includes(v))) {
      return { isStraight: true, high: 9 };
    }
  } else {
    // A-2-3-4-5 is the lowest regular straight.
    const wheel = [2, 3, 4, 5, 14];
    if (wheel.every(v => unique.includes(v))) {
      return { isStraight: true, high: 5 };
    }
  }

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

function evaluate5(cards: Card[], gameType: GameType): HandResult {
  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);
  const vals = ranks.map(r => rankValue(r)).sort((a, b) => b - a);

  const isFlush = new Set(suits).size === 1;
  const { isStraight, high: straightHigh } = checkStraight(vals, gameType);

  const rankCount: Record<string, number> = {};
  for (const r of ranks) rankCount[r] = (rankCount[r] || 0) + 1;

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
  if (counts[0] === 3 && counts[1] === 2) {
    const tripVal = groups.find(g => g.count === 3)!.val;
    const pairVal = groups.find(g => g.count === 2)!.val;
    const rank = gameType === 'short_deck' ? HAND_RANK.FLUSH : HAND_RANK.FULL_HOUSE;
    return { rank, name: HAND_NAME_EN[HAND_RANK.FULL_HOUSE], nameZh: HAND_NAME_ZH[HAND_RANK.FULL_HOUSE], tiebreak: [tripVal, pairVal] };
  }
  if (isFlush) {
    const rank = gameType === 'short_deck' ? HAND_RANK.FULL_HOUSE : HAND_RANK.FLUSH;
    return { rank, name: HAND_NAME_EN[HAND_RANK.FLUSH], nameZh: HAND_NAME_ZH[HAND_RANK.FLUSH], tiebreak: vals };
  }
  if (isStraight) {
    return { rank: HAND_RANK.STRAIGHT, name: HAND_NAME_EN[4], nameZh: HAND_NAME_ZH[4], tiebreak: [straightHigh] };
  }
  if (counts[0] === 3) {
    const tripVal = groups.find(g => g.count === 3)!.val;
    return { rank: HAND_RANK.THREE_OF_A_KIND, name: HAND_NAME_EN[3], nameZh: HAND_NAME_ZH[3], tiebreak: [tripVal, ...singleVals] };
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

export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function evaluateHand(cards: Card[], gameType: GameType = 'short_deck'): HandResult {
  const evalType: GameType = gameType === 'short_deck' ? 'short_deck' : 'regular';
  if (cards.length < 5) {
    return { rank: -1, name: 'Invalid', nameZh: '无效', tiebreak: [] };
  }
  if (cards.length === 5) return evaluate5(cards, evalType);

  let best: HandResult | null = null;
  let bestCombos: Card[][] = [];
  for (const combo of combinations(cards, 5)) {
    const result = evaluate5(combo, evalType);
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
