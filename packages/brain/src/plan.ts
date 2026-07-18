import {
  TestPlanSchema,
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
  const schema = TestPlanSchema.superRefine((plan, context) => {
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
