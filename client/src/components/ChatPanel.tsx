'use client';
import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types/poker';
import clsx from 'clsx';
import { useI18n } from '../i18n/LanguageProvider';

interface ChatPanelProps {
  messages: ChatMessage[];
  myPlayerId: string;
  onSend: (msg: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  unreadCount?: number;
}

export default function ChatPanel({ messages, myPlayerId, onSend, isOpen, onToggle, unreadCount = 0 }: ChatPanelProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
  }

  return (
    <div className="fixed bottom-28 right-4 z-50">
      {/* Chat window */}
      <div
        className={clsx(
          'mb-2 w-72 bg-felt-darker/95 border border-gold/20 rounded-xl overflow-hidden backdrop-blur-sm',
          'transition-all duration-200 origin-bottom-right',
          isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        )}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-gold/10 flex items-center justify-between">
          <span className="text-xs text-white/50 uppercase tracking-widest">{t('chat.title')}</span>
          <button onClick={onToggle} className="text-white/30 hover:text-white/70 text-sm">✕</button>
        </div>

        {/* Messages */}
        <div className="h-52 overflow-y-auto px-3 py-2 space-y-1.5">
          {messages.length === 0 && (
            <p className="text-xs text-white/30 text-center mt-8">{t('chat.empty')}</p>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={clsx('text-sm', msg.playerId === myPlayerId && 'text-right')}>
              {msg.playerId !== myPlayerId && (
                <span className="text-gold text-xs font-medium">{msg.playerName}: </span>
              )}
              <span className={clsx(
                'inline-block rounded-lg px-2.5 py-1 text-xs',
                msg.playerId === myPlayerId
                  ? 'bg-blue-900/60 text-blue-100 ml-8'
                  : 'bg-white/5 text-white/80'
              )}>
                {msg.message}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex border-t border-white/10 p-2 gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('chat.placeholder')}
            maxLength={200}
            className="flex-1 bg-transparent text-white text-sm placeholder:text-white/30 outline-none"
          />
          <button
            onClick={handleSend}
            className="bg-gold/80 hover:bg-gold text-black text-xs font-bold px-2.5 py-1 rounded-lg transition-colors"
          >
            {t('chat.send')}
          </button>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={clsx(
          'w-11 h-11 rounded-full bg-black/60 border border-gold/30 flex items-center justify-center',
          'hover:bg-gold/10 transition-colors relative ml-auto',
          isOpen && 'bg-gold/10 border-gold/60'
        )}
      >
        <span className="text-xl">💬</span>
        {unreadCount > 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[0.6rem] font-bold rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
