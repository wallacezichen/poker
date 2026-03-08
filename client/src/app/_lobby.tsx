'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import Lobby from '../components/Lobby';
import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../store/gameStore';

export default function LobbyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { createRoom, joinRoom } = useSocket();
  const { isConnected } = useGameStore();

  const initialRoomId = searchParams.get('room') || '';

  async function handleCreate(name: string, settings: any) {
    const res = await createRoom(name, settings);
    if (res.success && res.roomId) {
      router.push(`/room/${res.roomId}`);
    }
    return res;
  }

  async function handleJoin(roomId: string, name: string) {
    const res = await joinRoom(roomId, name);
    if (res.success) {
      router.push(`/room/${roomId}`);
    }
    return res;
  }

  return (
    <Lobby
      onCreateRoom={handleCreate}
      onJoinRoom={handleJoin}
      isConnected={isConnected}
      initialRoomId={initialRoomId}
    />
  );
}
