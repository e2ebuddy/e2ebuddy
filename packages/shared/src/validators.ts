import type { Issue, Judgement, TestPlan, UnderstandingDoc } from './schemas.js';

const severityDeductions = {
  blocker: 25,
  major: 10,
  suggestion: 2,
} as const;

export function calculateHealthScore(confirmedIssues: readonly Issue[]): number {
  const deduction = confirmedIssues.reduce(
    (total, issue) => total + severityDeductions[issue.severity],
    0,
  );
  return Math.max(0, 100 - deduction);
}

export function validateTestPlanCoverage(
  plan: TestPlan,
  understanding: UnderstandingDoc,
): string[] {
  const errors: string[] = [];
  const desktopVisual = plan.cases.some(
    (testCase) => testCase.layer === 'visual' && testCase.viewport === 'desktop',
  );
  const mobileVisual = plan.cases.some(
    (testCase) => testCase.layer === 'visual' && testCase.viewport === 'mobile',
  );

  if (!desktopVisual) errors.push('Test plan must include a desktop visual case.');
  if (!mobileVisual) errors.push('Test plan must include a mobile visual case.');
  if (!plan.cases.some((testCase) => testCase.layer === 'content')) {
    errors.push('Test plan must include a primary-page content case.');
  }
  const contentPlanText = plan.cases
    .filter((testCase) => testCase.layer === 'content')
    .map((testCase) => `${testCase.title} ${testCase.steps.join(' ')} ${testCase.expected}`)
    .join(' ')
    .toLowerCase();
  if (!/placeholder|lorem|todo|copy|content|占位|文案|内容/.test(contentPlanText)) {
    errors.push('Content coverage must explicitly check placeholders or copy quality.');
  }
  if (!/numeric|number|price|total|calculation|arithmetic|数值|数字|价格|总价|计算/.test(contentPlanText)) {
    errors.push('Content coverage must explicitly check numeric consistency.');
  }

  const declared = understanding.declaredRequirements ?? [];
  const declaredSet = new Set(declared);
  const appearances = new Map<string, number>();

  for (const requirement of declared) appearances.set(requirement, 0);
  for (const testCase of plan.cases) {
    for (const requirement of testCase.sourceRequirements ?? []) {
      if (!declaredSet.has(requirement)) {
        errors.push(`Case ${testCase.id} references an undeclared requirement: ${requirement}`);
        continue;
      }
      const requiredLayer = requirementLayer(requirement);
      if (testCase.layer !== requiredLayer) {
        errors.push(
          `Requirement must be mapped to a ${requiredLayer} case or untestedRequirements: ${requirement}`,
        );
      }
      appearances.set(requirement, (appearances.get(requirement) ?? 0) + 1);
    }
  }
  for (const requirement of plan.untestedRequirements) {
    if (!declaredSet.has(requirement)) {
      errors.push(`Untested requirement was not declared: ${requirement}`);
      continue;
    }
    appearances.set(requirement, (appearances.get(requirement) ?? 0) + 1);
  }

  for (const [requirement, count] of appearances) {
    if (count !== 1) {
      errors.push(`Declared requirement must be mapped exactly once: ${requirement}`);
    }
  }

  return errors;
}

export function requirementLayer(requirement: string): 'flow' | 'content' | 'visual' {
  const normalized = requirement.toLowerCase();
  if (/layout|responsive|viewport|spacing|color|font|visual|布局|响应式|间距|颜色|字体|视觉/.test(normalized)) {
    return 'visual';
  }
  if (/copy|wording|text|content|translation|文案|措辞|文本|内容|翻译/.test(normalized)) {
    return 'content';
  }
  return 'flow';
}

export function validateJudgementCoverage(judgement: Judgement, plan: TestPlan): string[] {
  const errors: string[] = [];
  const plannedCaseIds = new Set(plan.cases.map((testCase) => testCase.id));
  const resultCaseIds = new Set(judgement.caseResults.map((result) => result.caseId));

  for (const caseId of plannedCaseIds) {
    if (!resultCaseIds.has(caseId)) errors.push(`Missing CaseResult for ${caseId}.`);
  }
  for (const caseId of resultCaseIds) {
    if (!plannedCaseIds.has(caseId)) errors.push(`CaseResult references unknown case ${caseId}.`);
  }

  return errors;
}
