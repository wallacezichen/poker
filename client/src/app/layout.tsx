import type { Metadata } from 'next';
import { Bebas_Neue, Noto_Sans_SC } from 'next/font/google';
import './globals.css';

const bebas = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
  display: 'swap',
});

const noto = Noto_Sans_SC({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-noto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: '短牌扑克 · Short Deck Poker',
  description: 'Real-time multiplayer Short Deck Texas Hold\'em poker',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${bebas.variable} ${noto.variable}`}>
      <body className="font-body bg-felt-darker text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
