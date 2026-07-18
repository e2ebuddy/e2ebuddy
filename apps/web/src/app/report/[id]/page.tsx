import { notFound } from 'next/navigation';

import { getRun } from '../../../lib/server';
import { CopyButton } from './copy-button';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{id:string}> }) {
  const { id } = await params; const run = await getRun(id); if (run?.report === undefined) notFound();
  const report = run.report;
  return <main className="shell"><nav className="nav"><a className="brand" href="/">e2ebuddy</a><span className="muted">Checked by e2ebuddy ✓</span></nav>
    <section className="hero"><p className="eyebrow">Acceptance report</p><div className="score">{report.healthScore}</div><h2>{report.verdict}</h2><CopyButton value={report.combinedFixPrompt} label="复制完整修复 Prompt" /></section>
    <section className="grid">{report.issues.map(issue=><article className="issue" key={issue.id}><span className={`badge ${issue.severity}`}>{issue.severity}</span><h2>{issue.title}</h2><p>{issue.detail}</p><ol>{issue.reproSteps.map(step=><li key={step}>{step}</li>)}</ol>{issue.evidenceScreenshots.map(key=><a href={`/api/runs/${id}/artifacts/${key}`} key={key}><img src={`/api/runs/${id}/artifacts/${key}`} alt={`Evidence for ${issue.title}`} /></a>)}<CopyButton value={issue.fixPrompt}/></article>)}</section>
    {report.needsHumanReview.length>0&&<details className="panel"><summary>建议人工确认（{report.needsHumanReview.length}）</summary>{report.needsHumanReview.map(issue=><article key={issue.id}><h3>{issue.title}</h3><p>{issue.detail}</p></article>)}</details>}
    <section className="panel"><h2>覆盖范围</h2><h3>已检查</h3><ul>{report.coverage.testedFlows.map(item=><li key={item}>{item}</li>)}</ul><h3>未覆盖</h3><ul>{report.coverage.untestedNotes.map(item=><li key={item}>{item}</li>)}</ul></section><footer>分享此页面即可分享报告 · Run {id}</footer>
  </main>;
}
