import { UnderstandingDocSchema, type UnderstandingDoc } from 'shared';
import { z } from 'zod';

import { runAgentLoop, type AgentExecutor, type AgentLoopResult } from './agent-loop.js';
import type { ModelClient } from './model.js';
import { exploreActionPrompt, exploreSystemPrompt } from './prompts/explore.js';
import { requirementsPrompt, requirementsSystemPrompt } from './prompts/requirements.js';
import { understandingPrompt, understandingSystemPrompt } from './prompts/understanding.js';
import { requestStructured } from './structured-output.js';

const RequirementsExtractionSchema = z
  .object({ requirements: z.array(z.string().trim().min(1).max(5_000)) })
  .strict();

export interface ExploreInput {
  targetUrl: string;
  userBrief?: string;
}

export interface ExploreDependencies {
  executor: AgentExecutor;
  client: ModelClient;
  model: string;
}

export interface ExploreResult {
  understanding: UnderstandingDoc;
  loop: AgentLoopResult;
}

export async function explore(
  input: ExploreInput,
  dependencies: ExploreDependencies,
): Promise<ExploreResult> {
  const targetOrigin = new URL(input.targetUrl).origin;
  const loop = await runAgentLoop({
    executor: dependencies.executor,
    client: dependencies.client,
    model: dependencies.model,
    system: exploreSystemPrompt(targetOrigin),
    buildPrompt: exploreActionPrompt,
    purpose: 'explore-action',
    maxSteps: 25,
    timeoutMs: 180_000,
  });

  const declaredRequirements =
    input.userBrief === undefined || input.userBrief.trim().length === 0
      ? []
      : await extractRequirements(input.userBrief, dependencies);

  const understanding = await requestStructured({
    client: dependencies.client,
    model: dependencies.model,
    purpose: 'understanding-extract',
    system: understandingSystemPrompt(),
    schema: UnderstandingDocSchema,
    maxTokens: 4_096,
    content: [
      {
        type: 'text',
        text: understandingPrompt(buildExplorationTrace(loop), declaredRequirements),
      },
      {
        type: 'image',
        mediaType: 'image/jpeg',
        data: loop.finalPerception.screenshotBase64,
      },
    ],
  });

  return {
    loop,
    understanding: UnderstandingDocSchema.parse({
      ...understanding,
      declaredRequirements: declaredRequirements.length === 0 ? undefined : declaredRequirements,
    }),
  };
}

async function extractRequirements(
  userBrief: string,
  dependencies: ExploreDependencies,
): Promise<string[]> {
  const result = await requestStructured({
    client: dependencies.client,
    model: dependencies.model,
    purpose: 'requirements-extract',
    system: requirementsSystemPrompt(),
    schema: RequirementsExtractionSchema,
    maxTokens: 4_096,
    content: [{ type: 'text', text: requirementsPrompt(userBrief) }],
  });
  return [...new Set(result.requirements)];
}

function buildExplorationTrace(loop: AgentLoopResult): string {
  const initial = `Initial page\nURL: ${loop.initialPerception.url}\nTitle: ${
    loop.initialPerception.title
  }\nAccessibility:\n${loop.initialPerception.a11yTree.slice(0, 2_500)}`;
  const steps = loop.steps
    .map(
      (step, index) => `Step ${index + 1}
Action: ${JSON.stringify(step.action)}
Outcome: ${step.outcome}${step.note === undefined ? '' : `\nNote: ${step.note}`}
URL: ${step.url}
Title: ${step.title}
Accessibility:\n${step.a11ySnippet}`,
    )
    .join('\n\n');
  return `${initial}\n\n${steps}\n\nTermination: ${loop.termination} — ${loop.reason}`.slice(
    0,
    60_000,
  );
}
