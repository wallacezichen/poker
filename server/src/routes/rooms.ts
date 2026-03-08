import { Router, Request, Response } from 'express';
import { getRoom, getPlayers, getChatHistory } from '../db/supabase';
import supabase from '../db/supabase';

const router = Router();

// GET /api/rooms/:id — Get room info + players
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const roomData = await getRoom(id.toUpperCase());
  if (!roomData) {
    return res.status(404).json({ error: 'Room not found' });
  }
  const players = await getPlayers(id.toUpperCase());
  res.json({
    id: roomData.id,
    status: roomData.status,
    settings: roomData.settings,
    players,
    createdAt: roomData.created_at,
  });
});

// GET /api/rooms/:id/history — Get hand history
router.get('/:id/history', async (req: Request, res: Response) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit as string) || 20;

  const { data, error } = await supabase
    .from('hand_history')
    .select('*')
    .eq('room_id', id.toUpperCase())
    .order('played_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/rooms/:id/leaderboard — Get chip counts
router.get('/:id/leaderboard', async (req: Request, res: Response) => {
  const { id } = req.params;
  const players = await getPlayers(id.toUpperCase());

  const { data: roomData } = await supabase
    .from('rooms')
    .select('settings')
    .eq('id', id.toUpperCase())
    .single();

  const starting = roomData?.settings?.startingChips ?? 5000;

  const leaderboard = players
    .map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      chips: p.chips,
      netChips: p.chips - starting,
      isBot: p.isBot,
      isConnected: p.isConnected,
    }))
    .sort((a, b) => b.chips - a.chips);

  res.json(leaderboard);
});

// GET /api/rooms/:id/chat — Get chat history
router.get('/:id/chat', async (req: Request, res: Response) => {
  const { id } = req.params;
  const messages = await getChatHistory(id.toUpperCase(), 100);
  res.json(messages);
});

export default router;
