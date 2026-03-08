// Re-export all types — this mirrors server/src/types/poker.ts
// Keep in sync with server

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type GameStage = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type RoomStatus = 'waiting' | 'playing' | 'finished';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  chips: number;
  bet: number;
  totalBet: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  isBot: boolean;
  isConnected: boolean;
  seatIndex: number;
  revealedMask?: number; // bitmask: 1=left card, 2=right card
  revealedCount?: number;
  handResult?: HandResult;
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
  lastRaiseSize?: number;
  players: PlayerState[];
  winners?: WinnerInfo[];
  actionLog: ActionLogEntry[];
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
  action: string;
  amount?: number;
  timestamp: number;
}

export interface RoomSettings {
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  maxPlayers: number;
  actionTimeout: number;
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

export interface HandResultPayload {
  winners: WinnerInfo[];
  players: PlayerState[];
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

// Socket types
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
  'player:away': (payload: { away: boolean }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'room:join_request_decision': (payload: { requestId: string; approve: boolean; buyIn?: number }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:pause': (payload: { paused: boolean }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:start': (cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:reveal_cards': (payload: { slot: 1 | 2 }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'game:action': (payload: { action: ActionType; amount?: number }, cb: (res: { success: boolean; error?: string }) => void) => void;
  'chat:send': (payload: { message: string }) => void;
  'game:next_hand': () => void;
}

export interface ServerToClientEvents {
  'room:updated': (room: Room) => void;
  'room:join_request': (req: JoinRequest) => void;
  'room:join_approved': (payload: { room: Room; playerId: string; gameState?: GameState }) => void;
  'room:join_denied': (payload: { requestId: string; error?: string }) => void;
  'room:player_kicked': (payload: { roomId: string; reason?: string }) => void;
  'game:state': (state: GameState) => void;
  'game:action_made': (entry: ActionLogEntry & { state: GameState }) => void;
  'game:hand_result': (result: HandResultPayload) => void;
  'chat:message': (msg: ChatMessage) => void;
  'game:paused': (paused: boolean) => void;
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
