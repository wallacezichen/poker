'use client';
import { Suspense } from 'react';
import LobbyPage from './_lobby';
import { useI18n } from '../i18n/LanguageProvider';

export default function Home() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gold font-display text-2xl">{t('common.loading')}</div>}>
      <LobbyPage />
    </Suspense>
  );
}
