import {
  ReportSchema,
  calculateHealthScore,
  type EvidencePack,
  type Judgement,
  type Report,
  type TestPlan,
  type UnderstandingDoc,
} from 'shared';
import { z } from 'zod';

import type { ModelClient } from './model.js';
import { reportPrompt, reportSystemPrompt } from './prompts/report.js';
import { requestStructured } from './structured-output.js';

const ReportTextSchema = z
  .object({
    verdict: z.string().trim().min(1).max(2_000),
    combinedFixPrompt: z.string().trim().min(1).max(100_000),
  })
  .strict();

const severityOrder = { blocker: 0, major: 1, suggestion: 2 } as const;

export interface ComposeReportDependencies {
  client: ModelClient;
  model: string;
}

export async function composeReport(
  input: {
    understanding: UnderstandingDoc;
    plan: TestPlan;
    evidence: EvidencePack;
    judgement: Judgement;
  },
  dependencies: ComposeReportDependencies,
): Promise<Report> {
  const text = await requestStructured({
    client: dependencies.client,
    model: dependencies.model,
    purpose: 'report-compose',
    system: reportSystemPrompt(),
    content: [
      { type: 'text', text: reportPrompt(input.understanding, input.plan, input.judgement) },
    ],
    schema: ReportTextSchema,
    maxTokens: 8_192,
  });
  const issues = [...input.judgement.confirmedIssues].sort(
    (left, right) => severityOrder[left.severity] - severityOrder[right.severity],
  );
  const resultById = new Map(input.judgement.caseResults.map((result) => [result.caseId, result]));
  const testedFlows = input.plan.cases
    .filter((testCase) => ['passed', 'failed', 'needs-review'].includes(resultById.get(testCase.id)?.status ?? ''))
    .map((testCase) => testCase.title);
  const untestedNotes = [
    ...input.plan.cases
      .filter((testCase) => ['blocked', 'untested'].includes(resultById.get(testCase.id)?.status ?? ''))
      .map((testCase) => `${testCase.title}: ${resultById.get(testCase.id)?.summary ?? 'Not tested'}`),
    ...input.plan.untestedRequirements.map((requirement) => `Untested requirement: ${requirement}`),
    ...input.plan.untestedNotes,
  ];
  return ReportSchema.parse({
    healthScore: calculateHealthScore(issues),
    verdict: text.verdict,
    issues,
    needsHumanReview: input.judgement.needsHumanReview,
    coverage: { testedFlows, untestedNotes },
    combinedFixPrompt: text.combinedFixPrompt,
  });
}
