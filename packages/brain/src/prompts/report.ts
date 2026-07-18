import type { Judgement, TestPlan, UnderstandingDoc } from 'shared';

export function reportSystemPrompt(): string {
  return `You write concise acceptance-test reports in the product's primary language. Return JSON only: {"verdict":"string","combinedFixPrompt":"string"}. The fix prompt must list confirmed issues by severity with URL, reproduction, expected behavior, then a protection section containing only passed cases. Never describe review, blocked, or untested cases as passed. Example: {"verdict":"Core flow needs repair before release.","combinedFixPrompt":"Fix the confirmed issues below...\n\nDo not regress these passed behaviors: ..."}`;
}

export function reportPrompt(
  understanding: UnderstandingDoc,
  plan: TestPlan,
  judgement: Judgement,
): string {
  return `Language: ${understanding.primaryLanguage}\nUnderstanding: ${JSON.stringify(understanding)}\nPlan: ${JSON.stringify(plan)}\nJudgement: ${JSON.stringify(judgement)}`;
}
