import type { ReactNode } from 'react';
import './globals.css';
import { APP_NAME } from '@/lib/brand';
import { LANG_BOOT, Translator } from '@/components/Translator';

export const metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Real-estate CRM for leads, follow-ups and site visits',
};

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f4f5fa' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}<Translator /></body>
    </html>
  );
}
