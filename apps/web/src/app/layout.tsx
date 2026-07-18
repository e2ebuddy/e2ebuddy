import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'e2ebuddy — AI acceptance testing',
  description: 'Products built by AI, tested by AI.',
  openGraph: {
    title: 'e2ebuddy',
    description: 'AI 造的产品，AI 来验收。',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
