import { createClient } from '@supabase/supabase-js';
import { Room, RoomPlayer, RoomSettings, ChatMessage } from '../types/poker';
import { FullGameState } from '../game/engine';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default supabase;

function normalizeGameType(raw: unknown): RoomSettings['gameType'] {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'regular' || v === 'poker' || v === 'texas' || v === 'holdem') return 'regular';
  if (v === 'omaha') return 'omaha';
  if (v === 'crazy_pineapple' || v === 'crazy pineapple' || v === 'pineapple') return 'crazy_pineapple';
  return 'short_deck';
}

// ============================================================
// Room Operations
// ============================================================

export async function createRoom(
  roomId: string,
  hostId: string,
  settings: RoomSettings
): Promise<void> {
  const { error } = await supabase.from('rooms').insert({
    id: roomId,
    host_id: hostId,
    status: 'waiting',
    settings,
  });
  if (error) throw new Error(`Failed to create room: ${error.message}`);
}

export async function getRoom(roomId: string) {
  const { data, error } = await supabase
    .from('rooms')
    .select('*, players(*)')
    .eq('id', roomId)
    .single();
  if (error) return null;
  return data;
}

export async function updateRoomStatus(
  roomId: string,
  status: 'waiting' | 'playing' | 'finished'
): Promise<void> {
  await supabase.from('rooms').update({ status }).eq('id', roomId);
}

export async function updateRoomSettings(
  roomId: string,
  settings: RoomSettings
): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .update({ settings })
    .eq('id', roomId);
  if (error) throw new Error(`Failed to update room settings: ${error.message}`);
}

export async function updateRoomHost(
  roomId: string,
  hostId: string
): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .update({ host_id: hostId })
    .eq('id', roomId);
  if (error) throw new Error(`Failed to update room host: ${error.message}`);
}

// ============================================================
// Player Operations
// ============================================================

export async function upsertPlayer(
  roomId: string,
  player: RoomPlayer
): Promise<void> {
  const { error } = await supabase.from('players').upsert({
    id: player.id,
    room_id: roomId,
    name: player.name,
    avatar_color: player.color,
    chips: player.chips,
    seat_index: player.seatIndex,
    is_bot: player.isBot,
    is_connected: player.isConnected,
  });
  if (error) throw new Error(`Failed to upsert player: ${error.message}`);
}

export async function updatePlayerChips(
  roomId: string,
  playerId: string,
  chips: number
): Promise<void> {
  await supabase
    .from('players')
    .update({ chips })
    .eq('id', playerId)
    .eq('room_id', roomId);
}

export async function updatePlayerConnection(
  roomId: string,
  playerId: string,
  isConnected: boolean
): Promise<void> {
  await supabase
    .from('players')
    .update({ is_connected: isConnected })
    .eq('id', playerId)
    .eq('room_id', roomId);
}

export async function removePlayer(
  roomId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', playerId)
    .eq('room_id', roomId);
  if (error) throw new Error(`Failed to remove player: ${error.message}`);
}

export async function getPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomId)
    .order('seat_index');

  if (error || !data) return [];

  return data.map(p => ({
    id: p.id,
    name: p.name,
    color: p.avatar_color,
    chips: p.chips,
    seatIndex: p.seat_index,
    isBot: p.is_bot,
    isConnected: p.is_connected,
  }));
}

// ============================================================
// Game State Operations
// ============================================================

export async function saveGameState(state: FullGameState): Promise<void> {
  // Save deck separately (server-side only, never sent to clients)
  const { error } = await supabase.from('game_states').upsert({
    room_id: state.roomId,
    hand_number: state.handNumber,
    stage: state.stage,
    community_cards: state.communityCards,
    deck: state.deck,
    deck_index: state.deckIndex,
    pot: state.pot,
    current_bet: state.currentBet,
    small_blind: state.smallBlind,
    big_blind: state.bigBlind,
    dealer_index: state.dealerIndex,
    small_blind_index: state.smallBlindIndex,
    big_blind_index: state.bigBlindIndex,
    current_player_index: state.currentPlayerIndex,
    last_raise_index: state.lastRaiseIndex,
    player_states: state.players,
    winners: state.winners || null,
    action_log: state.actionLog,
  });
  if (error) throw new Error(`Failed to save game state: ${error.message}`);
}

export async function loadGameState(roomId: string): Promise<FullGameState | null> {
  const { data, error } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_id', roomId)
    .single();

  if (error || !data) return null;
  const { data: roomMeta } = await supabase
    .from('rooms')
    .select('settings')
    .eq('id', roomId)
    .single();

  const playersToAct = (data.players_to_act as string[] | null) ?? (
    (data.player_states || [])
      .filter((p: any) => !p.folded && !p.allIn && p.bet < data.current_bet)
      .map((p: any) => p.id)
  );

  return {
    roomId,
    gameType: normalizeGameType(roomMeta?.settings?.gameType),
    handNumber: data.hand_number,
    stage: data.stage,
    communityCards: data.community_cards,
    deck: data.deck,
    deckIndex: data.deck_index,
    pot: data.pot,
    currentBet: data.current_bet,
    smallBlind: data.small_blind,
    bigBlind: data.big_blind,
    dealerIndex: data.dealer_index,
    smallBlindIndex: data.small_blind_index,
    bigBlindIndex: data.big_blind_index,
    currentPlayerIndex: data.current_player_index,
    lastRaiseIndex: data.last_raise_index,
    lastRaiseSize: data.last_raise_size ?? data.big_blind ?? 100,
    players: data.player_states,
    winners: data.winners,
    actionLog: data.action_log,
    playersToAct,
  };
}

// ============================================================
// Hand History
// ============================================================

export async function saveHandHistory(state: FullGameState): Promise<void> {
  if (!state.winners) return;

  const playerHands = state.players.map(p => ({
    playerId: p.id,
    name: p.name,
    holeCards: p.holeCards,
    handName: p.handResult?.name,
    handNameZh: p.handResult?.nameZh,
    handRank: p.handResult?.rank,
    folded: p.folded,
    chipsEnd: p.chips,
  }));

  await supabase.from('hand_history').insert({
    room_id: state.roomId,
    hand_number: state.handNumber,
    stage_reached: state.stage,
    community_cards: state.communityCards,
    pot: state.pot,
    winners: state.winners,
    player_hands: playerHands,
    action_log: state.actionLog,
  });
}

// ============================================================
// Chat
// ============================================================

export async function saveChat(
  roomId: string,
  playerId: string,
  playerName: string,
  message: string
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ room_id: roomId, player_id: playerId, player_name: playerName, message })
    .select()
    .single();

  if (error || !data) {
    // fallback
    return {
      id: Math.random().toString(),
      playerId,
      playerName,
      message,
      sentAt: new Date().toISOString(),
    };
  }

  return {
    id: data.id,
    playerId: data.player_id,
    playerName: data.player_name,
    message: data.message,
    sentAt: data.sent_at,
  };
}

export async function getChatHistory(roomId: string, limit = 50): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.reverse().map(m => ({
    id: m.id,
    playerId: m.player_id,
    playerName: m.player_name,
    message: m.message,
    sentAt: m.sent_at,
  }));
}
