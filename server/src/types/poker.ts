// ============================================================
// Shared TypeScript types for Short Deck Poker
// Used by both server and client
// ============================================================

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type GameType = 'short_deck' | 'regular' | 'omaha' | 'crazy_pineapple';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type GameStage = 'waiting' | 'preflop' | 'flop' | 'flop_discard' | 'turn' | 'river' | 'showdown';
export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'discard';

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  chips: number;
  bet: number;           // current round bet
  totalBet: number;      // total bet this hand
  holeCards: Card[];     // only populated for self or at showdown
  folded: boolean;
  allIn: boolean;
  isBot: boolean;
  isConnected: boolean;
  seatIndex: number;
  revealedMask?: number; // bitmask: 1=left card, 2=right card
  revealedCount?: number; // public revealed hole card count at showdown
  runItTwiceHandNamesZh?: string[]; // [run1, run2] labels when run-it-twice is used
  handResult?: HandResult; // populated at showdown
}

export interface HandResult {
  rank: number;
  name: string;
  nameZh: string;
  tiebreak: number[];
  cards?: Card[];
}

export interface GameState {
  roomId: string;
  gameType?: GameType;
  deadBoardCards?: Card[];
  deadBoardRevealed?: boolean;
  bombPot?: {
    enabled: boolean;
    active: boolean;
    amount: number;
    interval: number;
    handsUntilNext: number;
  };
  twoSevenBonus?: {
    winnerId: string;
    winnerName: string;
    amountPerPlayer: number;
    total: number;
    collectedFrom: Array<{ playerId: string; playerName: string; amount: number }>;
  };
  handNumber: number;
  stage: GameStage;
  communityCards: Card[];
  pot: number;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentPlayerIndex: number;
  lastRaiseIndex: number;
  lastRaiseSize?: number; // size of previous full raise (used for minimum re-raise)
  runItTwice?: RunItTwiceState;
  players: PlayerState[];
  winners?: WinnerInfo[];
  actionLog: ActionLogEntry[];
}

export interface RunItTwiceState {
  status: 'pending' | 'agreed' | 'declined';
  votes: Record<string, boolean | null>;
  boards?: [Card[], Card[]];
  summary?: Array<{ name: string; handLabel: string }>;
  runResults?: Array<{ playerIds?: string[]; names: string[]; handLabel: string }>;
  baseStage?: GameStage;
  phase?: 'run1' | 'run1_showdown' | 'run2' | 'run2_showdown' | 'final';
}

export interface WinnerInfo {
  playerId: string;
  name: string;
  chipsWon: number;
  handName: string;
  handNameZh: string;
  holeCards: Card[];
}

export interface ActionLogEntry {
  playerId: string;
  playerName: string;
  action: ActionType | 'blind_small' | 'blind_big' | 'deal' | 'bomb_ante';
  amount?: number;
  timestamp: number;
}

export interface RoomSettings {
  gameType: GameType;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
  actionTimeout: number; // seconds
  bombPotEnabled: boolean;
  bombPotAmount: number;
  bombPotInterval: number;
  twoSevenEnabled: boolean;
  twoSevenAmount: number;
}

export interface Room {
  id: string;
  hostId: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: RoomPlayer[];
  createdAt: string;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  chips: number;
  seatIndex: number;
  isBot: boolean;
  isConnected: boolean;
  isAway?: boolean;
}

export interface JoinRequest {
  requestId: string;
  roomId: string;
  playerName: string;
  requestedAt: string;
}

// ============================================================
// Socket.IO event types (client → server)
// ============================================================
export interface ClientToServerEvents {
  'room:create': (payload: { playerName: string; settings: Partial<RoomSettings> }, cb: (res: RoomResponse) => void) => void;
  'room:join': (payload: { roomId: string; playerName: string }, cb: (res: RoomResponse) => void) => void;
  'room:resume': (payload: { roomId: string; playerId: string }, cb: (res: RoomResponse) => void) => void;
  'room:leave': () => void;
  'room:add_bot': (cb: (res: { success: boolean }) => void) => void;
  'room:host_manage_player': (
    payload: { targetPlayerId: string; action: 'set_chips' | 'kick'; chips?: number },
    cb: (res: { success: boolean; error?: string }) => void
  ) => void;
  'room:update_settings': (
    payload: { settings: Partial<Pick<RoomSettings, 'smallBlind' | 'bigBlind' | 'bombPotEnabled' | 'bombPotAmount' | 'bombPotInterval' | 'twoSevenEnabled' | 'twoSevenAmount'>> },
    cb: (res: { success: boolean; error?: string }) => void
  ) => void;
  'player:away': (payload: { away: boolean }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'room:join_request_decision': (payload: { requestId: string; approve: boolean; buyIn?: number }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:pause': (payload: { paused: boolean }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:start': (cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:reveal_cards': (payload: { slot: 1 | 2 }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:reveal_dead_board': (cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:run_it_twice_vote': (payload: { agree: boolean }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:rebuy_or_leave': (
    payload: { rebuy: boolean; buyIn?: number },
    cb: (res: { success: boolean; error?: string }) => void
  ) => void;
  'game:action': (payload: { action: ActionType; amount?: number }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'chat:send': (payload: { message: string }) => void;
  'game:next_hand': () => void;
}

// ============================================================
// Socket.IO event types (server → client)
// ============================================================
export interface ServerToClientEvents {
  'room:updated': (room: Room) => void;
  'room:join_request': (req: JoinRequest) => void;
  'room:join_approved': (payload: { room: Room; playerId: string; gameState?: GameState }) => void;
  'room:join_denied': (payload: { requestId: string; error?: string }) => void;
  'room:player_kicked': (payload: { roomId: string; reason?: string }) => void;
  'game:state': (state: GameState) => void;
  'game:action_made': (entry: ActionLogEntry & { state: GameState }) => void;
  'game:hand_result': (result: HandResultPayload) => void;
  'game:player_rebuy': (payload: { playerId: string }) => void;
  'game:rebuy_counts': (payload: { counts: Record<string, number> }) => void;
  'chat:message': (msg: ChatMessage) => void;
  'game:paused': (paused: boolean) => void;
  'game:rebuy_prompt': (payload: { minBuyIn: number; defaultBuyIn: number }) => void;
  'player:connected': (playerId: string) => void;
  'player:disconnected': (playerId: string) => void;
  'error': (msg: string) => void;
}

export interface RoomResponse {
  success: boolean;
  error?: string;
  pendingApproval?: boolean;
  requestId?: string;
  room?: Room;
  playerId?: string;
  gameState?: GameState;
}

export interface HandResultPayload {
  winners: WinnerInfo[];
  players: PlayerState[];      // all players with revealed cards
  pot: number;
  handNumber: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  sentAt: string;
}
