import type { LocalRun } from './types.js';

/** Build a user-facing Markdown report from a completed run. */
export function buildReportMarkdown(run: LocalRun, productName = 'e2ebuddy'): string {
  const report = run.report as Record<string, unknown> | null;
  const lines: string[] = [];
  lines.push(`# ${productName} Acceptance Report`);
  lines.push('');
  lines.push(`- **Run ID:** \`${run.id}\``);
  lines.push(`- **Target:** ${run.targetUrl}`);
  lines.push(`- **Status:** ${run.status}`);
  lines.push(`- **Created:** ${run.createdAt}`);
  if (run.userBrief) lines.push(`- **Brief:** ${run.userBrief}`);
  lines.push('');

  if (!report) {
    lines.push('_No report payload yet._');
    if (run.error) {
      lines.push('');
      lines.push('## Error');
      lines.push('');
      lines.push('```');
      lines.push(run.error);
      lines.push('```');
    }
    return `${lines.join('\n')}\n`;
  }

  const mode = String(report.mode ?? 'unknown');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- **Pipeline mode:** ${mode}`);
  if (report.healthScore !== undefined) lines.push(`- **Health score:** ${report.healthScore}`);
  if (report.verdict) lines.push(`- **Verdict:** ${String(report.verdict)}`);
  if (report.summary) lines.push(`- **Notes:** ${String(report.summary)}`);
  if (report.outputDirectory) {
    lines.push(`- **Artifacts:** \`${String(report.outputDirectory)}\``);
  }
  lines.push('');

  const issues = Array.isArray(report.issues) ? report.issues : [];
  lines.push(`## Issues (${issues.length})`);
  lines.push('');
  if (issues.length === 0) {
    lines.push('_No confirmed issues._');
  } else {
    for (const raw of issues) {
      const issue = raw as Record<string, unknown>;
      lines.push(`### ${String(issue.title ?? issue.id ?? 'Issue')}`);
      lines.push('');
      lines.push(`- **Severity:** ${String(issue.severity ?? '—')}`);
      lines.push(`- **Confidence:** ${String(issue.confidence ?? '—')}`);
      if (issue.pageUrl) lines.push(`- **Page:** ${String(issue.pageUrl)}`);
      if (issue.expected) lines.push(`- **Expected:** ${String(issue.expected)}`);
      if (issue.actual) lines.push(`- **Actual:** ${String(issue.actual)}`);
      lines.push('');
      lines.push(String(issue.detail ?? ''));
      lines.push('');
      const steps = Array.isArray(issue.reproSteps) ? issue.reproSteps : [];
      if (steps.length > 0) {
        lines.push('**Repro steps**');
        lines.push('');
        for (const [index, step] of steps.entries()) {
          lines.push(`${index + 1}. ${String(step)}`);
        }
        lines.push('');
      }
      if (issue.domEvidence) {
        lines.push('**DOM evidence**');
        lines.push('');
        lines.push('```');
        lines.push(String(issue.domEvidence).slice(0, 2_000));
        lines.push('```');
        lines.push('');
      }
      if (issue.a11yEvidence) {
        lines.push('**A11y evidence**');
        lines.push('');
        lines.push('```');
        lines.push(String(issue.a11yEvidence).slice(0, 2_000));
        lines.push('```');
        lines.push('');
      }
      if (issue.fixPrompt) {
        lines.push('**Fix prompt**');
        lines.push('');
        lines.push('```');
        lines.push(String(issue.fixPrompt));
        lines.push('```');
        lines.push('');
      }
    }
  }

  const full = report.full as Record<string, unknown> | undefined;
  if (full?.combinedFixPrompt) {
    lines.push('## Combined fix prompt');
    lines.push('');
    lines.push('```');
    lines.push(String(full.combinedFixPrompt));
    lines.push('```');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
