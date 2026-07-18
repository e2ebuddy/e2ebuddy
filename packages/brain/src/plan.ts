import {
  TestPlanSchema,
  requirementLayer,
  validateTestPlanCoverage,
  type TestPlan,
  type UnderstandingDoc,
} from 'shared';

import type { ModelClient } from './model.js';
import { planPrompt, planSystemPrompt } from './prompts/plan.js';
import { requestStructured } from './structured-output.js';

export interface PlanDependencies {
  client: ModelClient;
  model: string;
}

export async function generatePlan(
  understanding: UnderstandingDoc,
  dependencies: PlanDependencies,
): Promise<TestPlan> {
  const schema = TestPlanSchema
    .transform((plan) => normalizeRequirementMappings(plan, understanding))
    .superRefine((plan, context) => {
    for (const error of validateTestPlanCoverage(plan, understanding)) {
      context.addIssue({ code: 'custom', message: error });
    }
  });
  return requestStructured({
    client: dependencies.client,
    model: dependencies.model,
    purpose: 'plan-generate',
    system: planSystemPrompt(),
    content: [{ type: 'text', text: planPrompt(understanding) }],
    schema,
    maxTokens: 6_144,
  });
}

function normalizeRequirementMappings(
  plan: TestPlan,
  understanding: UnderstandingDoc,
): TestPlan {
  const declared = understanding.declaredRequirements ?? [];
  const declaredSet = new Set(declared);
  const cases = plan.cases.map((testCase) => ({
    ...testCase,
    sourceRequirements: (testCase.sourceRequirements ?? []).filter((requirement) =>
      declaredSet.has(requirement)),
  }));
  const untestedRequirements: string[] = [];

  for (const requirement of declared) {
    const requiredLayer = requirementLayer(requirement);
    const matchingIndexes = cases.flatMap((testCase, index) =>
      testCase.layer === requiredLayer && testCase.sourceRequirements.includes(requirement)
        ? [index]
        : [],
    );
    const selectedIndex = matchingIndexes[0];
    for (const [index, testCase] of cases.entries()) {
      testCase.sourceRequirements = testCase.sourceRequirements.filter(
        (candidate) => candidate !== requirement || index === selectedIndex,
      );
    }
    if (selectedIndex === undefined) untestedRequirements.push(requirement);
  }

  return TestPlanSchema.parse({
    ...plan,
    cases: cases.map(({ sourceRequirements, ...testCase }) =>
      sourceRequirements.length === 0 ? testCase : { ...testCase, sourceRequirements }),
    untestedRequirements,
  });
}
