'use client';
import React from 'react';
import { LanguageProvider } from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { ChromeProvider, useChrome } from '../ui/ChromeProvider';

function ChromeAwareLanguageSwitcher() {
  const { inGame } = useChrome();
  return inGame ? null : <LanguageSwitcher />;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ChromeProvider>
      <LanguageProvider>
        <ChromeAwareLanguageSwitcher />
        {children}
      </LanguageProvider>
    </ChromeProvider>
  );
}
