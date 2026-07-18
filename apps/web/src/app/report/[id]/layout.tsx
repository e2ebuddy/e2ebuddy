import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getRun } from '../../../lib/server';

export async function generateMetadata({ params }: { params: Promise<{id:string}> }): Promise<Metadata> {
  const { id } = await params;
  const run = await getRun(id).catch(() => undefined);
  const score = run?.report?.healthScore;
  const title = score === undefined ? 'e2ebuddy acceptance report' : `${score}/100 · e2ebuddy report`;
  const description = run?.report?.verdict ?? 'Evidence-backed AI acceptance testing report.';
  return { title, description, openGraph: { title, description, type: 'article' }, twitter: { card: 'summary_large_image', title, description } };
}

export default function ReportLayout({ children }: { children: ReactNode }) { return children; }
