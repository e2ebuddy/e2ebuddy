import {
  CaseResultSchema,
  IssueSchema,
  JudgementSchema,
  validateJudgementCoverage,
  type CaseResult,
  type EvidencePack,
  type Issue,
  type Judgement,
  type TestCase,
  type TestPlan,
  type UnderstandingDoc,
} from 'shared';
import type { StorageAdapter } from 'storage';
import { z } from 'zod';

import type { ModelClient, ModelContentBlock } from './model.js';
import { judgeCasePrompt, judgeSystemPrompt } from './prompts/judge.js';
import { requestStructured } from './structured-output.js';

const CaseJudgementSchema = z
  .object({
    summary: z.string().trim().min(1).max(5_000),
    issues: z.array(IssueSchema).max(10),
  })
  .strict();

export interface JudgeDependencies {
  client: ModelClient;
  model: string;
  storage: StorageAdapter;
}

export interface JudgeInput {
  runId: string;
  understanding: UnderstandingDoc;
  plan: TestPlan;
  evidence: EvidencePack;
}

export async function judgeRun(
  input: JudgeInput,
  dependencies: JudgeDependencies,
): Promise<Judgement> {
  const confirmedIssues: Issue[] = [];
  const needsHumanReview: Issue[] = [];
  const caseResults: CaseResult[] = [];
  const usedIssueIds = new Set<string>();

  for (const testCase of input.plan.cases) {
    const evidence = input.evidence.steps.filter((step) => step.caseId === testCase.id);
    if (evidence.length === 0) {
      caseResults.push(
        CaseResultSchema.parse({
          caseId: testCase.id,
          status: 'untested',
          summary: 'No execution evidence was captured.',
          issueIds: [],
        }),
      );
      continue;
    }

    const content: ModelContentBlock[] = [
      { type: 'text', text: judgeCasePrompt(testCase, input.understanding, evidence) },
    ];
    for (const step of evidence.slice(-4)) {
      const image = await dependencies.storage.get(input.runId, step.screenshotKey);
      content.push({ type: 'image', mediaType: 'image/jpeg', data: Buffer.from(image).toString('base64') });
    }
    const raw = await requestStructured({
      client: dependencies.client,
      model: dependencies.model,
      purpose: `judge-${testCase.layer}`,
      system: judgeSystemPrompt(),
      content,
      schema: CaseJudgementSchema,
      maxTokens: 4_096,
    });
    const knownKeys = new Set(evidence.map((step) => step.screenshotKey));
    const issues = [
      ...deterministicEvidenceIssues(testCase, evidence, usedIssueIds),
      ...raw.issues.filter((issue) => isRelevantToLayer(issue, testCase.layer)).map((issue, index) =>
        normalizeIssue(issue, testCase, index, usedIssueIds, knownKeys),
      ),
    ];
    const confirmed = issues.filter((issue) => issue.confidence >= 0.7);
    const review = issues.filter((issue) => issue.confidence < 0.7);
    confirmedIssues.push(...confirmed);
    needsHumanReview.push(...review);

    const blocked = evidence.some((step) => step.outcome === 'blocked');
    const status =
      confirmed.length > 0
        ? 'failed'
        : review.length > 0
          ? 'needs-review'
          : blocked
            ? 'blocked'
            : 'passed';
    caseResults.push(
      CaseResultSchema.parse({
        caseId: testCase.id,
        status,
        summary: raw.summary,
        issueIds: issues.map((issue) => issue.id),
      }),
    );
  }

  if (input.plan.untestedRequirements.length > 0) {
    const evidence = input.evidence.steps.slice(-4);
    const knownKeys = new Set(evidence.map((step) => step.screenshotKey));
    const syntheticCase: TestCase = {
      id: 'missing-feature',
      layer: 'content',
      title: 'Declared requirements',
      steps: ['Compare declared requirements with observed product'],
      expected: 'Declared capabilities are implemented',
    };
    for (const requirement of input.plan.untestedRequirements) {
      const content: ModelContentBlock[] = [
        {
          type: 'text',
          text: `Determine whether this one declared but untested requirement is genuinely absent from the observed product: ${JSON.stringify(requirement)}\nValidated understanding: ${JSON.stringify(input.understanding)}\nReturn exactly one missing-feature issue when the capability is absent, otherwise return no issue. Do not evaluate any other requirement.`,
        },
      ];
      for (const step of evidence) {
        const image = await dependencies.storage.get(input.runId, step.screenshotKey);
        content.push({ type: 'image', mediaType: 'image/jpeg', data: Buffer.from(image).toString('base64') });
      }
      const missing = await requestStructured({
        client: dependencies.client,
        model: dependencies.model,
        purpose: 'judge-missing-feature',
        system: judgeSystemPrompt(),
        content,
        schema: z
          .object({
            summary: z.string().trim().min(1).max(5_000).optional(),
            issues: z.array(IssueSchema).max(1),
          })
          .strict(),
        maxTokens: 4_096,
      });
      for (const [index, rawIssue] of missing.issues.entries()) {
        const issue = IssueSchema.parse({
          ...normalizeIssue(rawIssue, syntheticCase, index, usedIssueIds, knownKeys),
          layer: 'missing-feature',
        });
        if (issue.confidence >= 0.7) confirmedIssues.push(issue);
        else needsHumanReview.push(issue);
      }
    }
  }

  const allEvidenceText = input.evidence.steps.map((step) => step.a11ySnippet).join('\n');
  for (const requirement of input.understanding.declaredRequirements ?? []) {
    if (!/\bcsv\b/i.test(requirement) || /\bexport\b|导出/i.test(allEvidenceText)) continue;
    const latest = input.evidence.steps.at(-1);
    confirmedIssues.push(IssueSchema.parse({
      id: uniqueIssueId('missing-csv-export', usedIssueIds),
      layer: 'missing-feature',
      severity: 'major',
      confidence: 1,
      title: 'CSV export capability is missing',
      detail: `The declared requirement ${JSON.stringify(requirement)} has no export control or CSV capability anywhere in the collected page evidence.`,
      reproSteps: ['Open the product', 'Inspect available controls for an export action'],
      evidenceScreenshots: latest === undefined ? [] : [latest.screenshotKey],
      pageUrl: latest?.urlAfter ?? input.understanding.pages[0]?.url ?? 'https://invalid.example/',
      fixPrompt: 'Add a discoverable CSV export action and generate a valid CSV file from the displayed results.',
    }));
  }

  const deduplicated = deduplicateIssues([...confirmedIssues, ...needsHumanReview]);
  const retainedIds = new Set(deduplicated.map((issue) => issue.id));
  const reconciledCaseResults = caseResults.map((result) => {
    const issueIds = result.issueIds.filter((id) => retainedIds.has(id));
    return CaseResultSchema.parse({
      ...result,
      status: issueIds.length === 0 && ['failed', 'needs-review'].includes(result.status)
        ? 'passed'
        : result.status,
      issueIds,
    });
  });
  const judgement = JudgementSchema.parse({
    caseResults: reconciledCaseResults,
    confirmedIssues: deduplicated.filter((issue) => issue.confidence >= 0.7),
    needsHumanReview: deduplicated.filter((issue) => issue.confidence < 0.7),
  });
  const errors = validateJudgementCoverage(judgement, input.plan);
  if (errors.length > 0) throw new Error(`Invalid judgement coverage: ${errors.join('; ')}`);
  return judgement;
}

export function deduplicateIssues(issues: readonly Issue[]): Issue[] {
  const retained = new Map<string, Issue>();
  for (const issue of issues) {
    if (isContradictedIssue(issue)) continue;
    const key = issueFamilyKey(issue);
    const current = retained.get(key);
    if (current === undefined || issue.confidence > current.confidence) retained.set(key, issue);
  }
  return [...retained.values()];
}

function issueFamilyKey(issue: Issue): string {
  const text = `${issue.title} ${issue.detail}`.toLowerCase();
  const page = new URL(issue.pageUrl).origin + new URL(issue.pageUrl).pathname;
  const family = text.includes('lorem ipsum')
    ? 'placeholder:lorem'
    : /\btodo\b/.test(text)
      ? 'placeholder:todo'
      : /horizontal.{0,30}overflow|overflow.{0,30}horizontal|viewport.{0,30}overflow|overflow.{0,30}viewport|mobile.{0,30}overflow/.test(text)
        ? 'layout:horizontal-overflow'
        : /arithmetic|calculation|calculated|mathematical|mathematically|numeric contradiction|total.{0,40}(contradict|incorrect)|contradict.{0,40}total|pricing.{0,30}contradiction/.test(text)
          ? 'content:arithmetic'
          : /\bcsv\b/.test(text)
            ? 'feature:csv'
            : /pricing/.test(text) && /missing|not present|no section/.test(text)
              ? 'feature:pricing'
              : normalizeIssueText(issue.title);
  return `${page}|${family}`;
}

function normalizeIssueText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, ' ')
    .trim();
}

function isRelevantToLayer(issue: Issue, layer: TestCase['layer']): boolean {
  const text = `${issue.title} ${issue.detail}`.toLowerCase();
  if (layer === 'flow') {
    return !/lorem|\btodo\b|placeholder|arithmetic|calculation|mathematical|numeric contradiction|horizontal overflow/.test(text);
  }
  if (layer === 'visual') {
    return !/arithmetic|calculation|mathematical|numeric contradiction/.test(text);
  }
  return true;
}

function isContradictedIssue(issue: Issue): boolean {
  const text = `${issue.title} ${issue.detail}`.toLowerCase();
  const isAnchorFailure = /anchor|scroll/.test(text);
  const evidenceSaysTargetExists = /hash target exists/.test(text) || /hashtargettop=(?!none)/.test(text);
  const cannotScrollFurther = /maxscrolly=0/.test(text) || /reached maxscrolly/.test(text);
  return isAnchorFailure && evidenceSaysTargetExists && cannotScrollFurther;
}

function uniqueIssueId(preferred: string, usedIssueIds: Set<string>): string {
  let id = preferred;
  let suffix = 2;
  while (usedIssueIds.has(id)) {
    id = `${preferred}-${suffix}`;
    suffix += 1;
  }
  usedIssueIds.add(id);
  return id;
}

function deterministicEvidenceIssues(
  testCase: TestCase,
  evidence: readonly EvidencePack['steps'][number][],
  usedIssueIds: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  const latest = evidence.at(-1);
  if (latest === undefined) return issues;
  const combinedTree = evidence.map((step) => step.a11ySnippet).join('\n');
  const add = (candidate: Issue) => {
    issues.push(normalizeIssue(candidate, testCase, issues.length, usedIssueIds, new Set([latest.screenshotKey])));
  };

  if (testCase.layer === 'content' && /lorem ipsum/i.test(combinedTree)) {
    add({
      id: 'deterministic-lorem-placeholder',
      layer: 'content',
      severity: 'major',
      confidence: 1,
      title: 'Lorem ipsum placeholder text is visible',
      detail: 'The rendered page contains Lorem ipsum placeholder copy instead of finished product content.',
      reproSteps: ['Open the page', 'Inspect the visible copy'],
      evidenceScreenshots: [latest.screenshotKey],
      pageUrl: latest.urlAfter,
      fixPrompt: 'Replace the Lorem ipsum placeholder with final product copy.',
    });
  }
  if (
    testCase.layer === 'content'
    && (/\bTODO\b/.test(combinedTree) || /placeholder/i.test(combinedTree))
  ) {
    add({
      id: 'deterministic-todo-placeholder',
      layer: 'content',
      severity: 'major',
      confidence: 1,
      title: 'TODO or placeholder content is visible',
      detail: 'The rendered page exposes TODO or placeholder content to the user.',
      reproSteps: ['Open the page', 'Inspect the visible content'],
      evidenceScreenshots: [latest.screenshotKey],
      pageUrl: latest.urlAfter,
      fixPrompt: 'Replace the TODO or placeholder with final content or a deliberate empty state.',
    });
  }
  if (testCase.layer === 'content') {
    const quantity = combinedTree.match(/quantity\D{0,12}(\d+(?:\.\d+)?)/i)?.[1];
    const unitPrice = combinedTree.match(/unit price\D{0,12}(\d+(?:\.\d+)?)/i)?.[1];
    const total = combinedTree.match(/total\D{0,12}(\d+(?:\.\d+)?)/i)?.[1];
    if (quantity !== undefined && unitPrice !== undefined && total !== undefined) {
      const expected = Number(quantity) * Number(unitPrice);
      if (Math.abs(expected - Number(total)) > 0.005) {
        add({
          id: 'deterministic-arithmetic-contradiction',
          layer: 'content',
          severity: 'major',
          confidence: 1,
          title: 'Displayed total contradicts quantity and unit price',
          detail: `The page shows quantity ${quantity}, unit price ${unitPrice}, and total ${total}; the calculated total is ${expected}.`,
          reproSteps: ['Open the page', 'Compare quantity, unit price, and total'],
          evidenceScreenshots: [latest.screenshotKey],
          pageUrl: latest.urlAfter,
          fixPrompt: `Correct the displayed total to ${expected} or make the inputs consistent.`,
        });
      }
    }
  }
  if (testCase.layer === 'visual') {
    const overflow = [...combinedTree.matchAll(/horizontalOverflow=(\d+)px/g)]
      .map((match) => Number(match[1]))
      .find((value) => value > 0);
    if (overflow !== undefined) {
      add({
        id: 'deterministic-horizontal-overflow',
        layer: 'visual',
        severity: 'major',
        confidence: 1,
        title: 'Page has horizontal viewport overflow',
        detail: `Layout diagnostics report ${overflow}px of horizontal overflow at the tested viewport.`,
        reproSteps: ['Open the page at the tested viewport', 'Observe horizontal overflow'],
        evidenceScreenshots: [latest.screenshotKey],
        pageUrl: latest.urlAfter,
        fixPrompt: 'Make fixed-width content responsive so document width does not exceed the viewport.',
      });
    }
  }
  return issues;
}

function normalizeIssue(
  issue: Issue,
  testCase: TestCase,
  index: number,
  usedIssueIds: Set<string>,
  knownKeys: Set<string>,
): Issue {
  let id = issue.id;
  if (usedIssueIds.has(id)) id = `${testCase.id}-${index + 1}-${id}`.slice(0, 128);
  usedIssueIds.add(id);
  const evidenceScreenshots = issue.evidenceScreenshots.filter((key) => knownKeys.has(key));
  return IssueSchema.parse({
    ...issue,
    id,
    layer: testCase.layer,
    severity: issue.confidence < 0.7 ? 'suggestion' : issue.severity,
    evidenceScreenshots,
  });
}
