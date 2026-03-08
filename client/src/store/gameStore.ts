import { create } from 'zustand';
import { GameState, Room, ChatMessage, HandResultPayload, JoinRequest } from '../types/poker';

interface GameStore {
  // Connection
  isConnected: boolean;
  setConnected: (v: boolean) => void;

  // Room
  room: Room | null;
  setRoom: (r: Room | null) => void;

  // My identity
  myPlayerId: string | null;
  setMyPlayerId: (id: string) => void;

  // Game
  gameState: GameState | null;
  setGameState: (s: GameState | null) => void;

  // Last hand result (shown in overlay)
  handResult: HandResultPayload | null;
  setHandResult: (r: HandResultPayload | null) => void;

  // Chat
  chatMessages: ChatMessage[];
  addChatMessage: (m: ChatMessage) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;

  // Join request queue (host)
  joinRequests: JoinRequest[];
  addJoinRequest: (r: JoinRequest) => void;
  removeJoinRequest: (requestId: string) => void;
  clearJoinRequests: () => void;

  // Pending join approval state (joiner)
  joinPending: { roomId: string; requestId?: string; status: 'pending' | 'denied'; error?: string } | null;
  setJoinPending: (v: { roomId: string; requestId?: string; status: 'pending' | 'denied'; error?: string } | null) => void;

  // UI state
  showHandResult: boolean;
  setShowHandResult: (v: boolean) => void;
  isGamePaused: boolean;
  setGamePaused: (v: boolean) => void;
  isChatOpen: boolean;
  toggleChat: () => void;

  // Action timer (seconds remaining)
  timerSeconds: number;
  setTimerSeconds: (s: number) => void;

  // Reset
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  isConnected: false,
  setConnected: (isConnected) => set({ isConnected }),

  room: null,
  setRoom: (room) => set({ room }),

  myPlayerId: null,
  setMyPlayerId: (myPlayerId) => set({ myPlayerId }),

  gameState: null,
  setGameState: (gameState) => set({ gameState }),

  handResult: null,
  setHandResult: (handResult) => set({ handResult }),

  chatMessages: [],
  addChatMessage: (m) => set(s => ({ chatMessages: [...s.chatMessages.slice(-100), m] })),
  setChatMessages: (chatMessages) => set({ chatMessages }),

  joinRequests: [],
  addJoinRequest: (r) => set(s => {
    if (s.joinRequests.some(x => x.requestId === r.requestId)) return s;
    return { joinRequests: [...s.joinRequests, r] };
  }),
  removeJoinRequest: (requestId) => set(s => ({ joinRequests: s.joinRequests.filter(r => r.requestId !== requestId) })),
  clearJoinRequests: () => set({ joinRequests: [] }),

  joinPending: null,
  setJoinPending: (joinPending) => set({ joinPending }),

  showHandResult: false,
  setShowHandResult: (showHandResult) => set({ showHandResult }),
  isGamePaused: false,
  setGamePaused: (isGamePaused) => set({ isGamePaused }),

  isChatOpen: false,
  toggleChat: () => set(s => ({ isChatOpen: !s.isChatOpen })),

  timerSeconds: 30,
  setTimerSeconds: (timerSeconds) => set({ timerSeconds }),

  reset: () => set({
    room: null,
    myPlayerId: null,
    gameState: null,
    handResult: null,
    chatMessages: [],
    joinRequests: [],
    joinPending: null,
    showHandResult: false,
    isGamePaused: false,
    timerSeconds: 30,
  }),
}));
