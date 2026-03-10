'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useI18n } from '../i18n/LanguageProvider';
import type { Locale } from '../i18n/translations';

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, []);

  function pick(next: Locale) {
    setLocale(next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="fixed top-4 right-4 z-[100]">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            'px-3 py-2 rounded-full border backdrop-blur-sm transition-colors',
            'bg-black/40 border-white/20 text-white/85 hover:bg-black/55 hover:border-white/35',
            'text-xs font-semibold tracking-widest uppercase'
          )}
          aria-label={t('lang.label')}
        >
          {locale === 'zh' ? '中文' : 'EN'}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-40 overflow-hidden rounded-xl border border-white/15 bg-black/70 backdrop-blur-md shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              onClick={() => pick('en')}
              className={clsx(
                'w-full px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-white/10',
                locale === 'en' ? 'text-gold' : 'text-white/85'
              )}
            >
              {t('lang.en')}
            </button>
            <button
              type="button"
              onClick={() => pick('zh')}
              className={clsx(
                'w-full px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-white/10',
                locale === 'zh' ? 'text-gold' : 'text-white/85'
              )}
            >
              {t('lang.zh')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

