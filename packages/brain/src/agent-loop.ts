import {
  AgentActionSchema,
  type ActionResult,
  type AgentAction,
  type PagePerception,
} from 'shared';

import type { ModelClient } from './model.js';
import { requestStructured } from './structured-output.js';

export interface AgentExecutor {
  perceive(): Promise<PagePerception>;
  execute(action: AgentAction): Promise<ActionResult>;
}

export interface AgentLoopStep {
  action: AgentAction;
  outcome: ActionResult['outcome'];
  url: string;
  title: string;
  a11ySnippet: string;
  screenshotBase64: string;
  note?: string;
}

export type AgentLoopTermination = 'done' | 'step-limit' | 'timeout' | 'model-error';

export interface AgentLoopResult {
  initialPerception: PagePerception;
  finalPerception: PagePerception;
  steps: AgentLoopStep[];
  termination: AgentLoopTermination;
  reason: string;
}

export interface RunAgentLoopOptions {
  executor: AgentExecutor;
  client: ModelClient;
  model: string;
  system: string;
  buildPrompt: (state: AgentPromptState) => string;
  purpose?: string;
  maxSteps?: number;
  timeoutMs?: number;
  now?: () => number;
}

export interface AgentPromptState {
  cumulativeSummary: string;
  recentHistory: string;
  url: string;
  title: string;
  a11yTree: string;
  interactablesJson: string;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const maxSteps = options.maxSteps ?? 25;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const initialPerception = await options.executor.perceive();
  let perception = initialPerception;
  const steps: AgentLoopStep[] = [];

  while (steps.length < maxSteps) {
    if (now() - startedAt >= timeoutMs) {
      return {
        initialPerception,
        finalPerception: perception,
        steps,
        termination: 'timeout',
        reason: 'Agent loop reached its time limit.',
      };
    }

    let action: AgentAction;
    try {
      action = await requestStructured({
        client: options.client,
        model: options.model,
        purpose: options.purpose ?? 'agent-action',
        system: options.system,
        schema: AgentActionSchema,
        maxTokens: 1_024,
        content: [
          {
            type: 'text',
            text: options.buildPrompt({
              cumulativeSummary: cumulativeSummary(steps),
              recentHistory: recentHistory(steps),
              url: perception.url,
              title: perception.title,
              a11yTree: perception.a11yTree,
              interactablesJson: JSON.stringify(perception.interactables),
            }),
          },
          { type: 'image', mediaType: 'image/jpeg', data: perception.screenshotBase64 },
        ],
      });
    } catch (error) {
      return {
        initialPerception,
        finalPerception: perception,
        steps,
        termination: 'model-error',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (action.type === 'done') {
      steps.push({
        action,
        outcome: 'ok',
        url: perception.url,
        title: perception.title,
        a11ySnippet: perception.a11yTree.slice(0, 2_000),
        screenshotBase64: perception.screenshotBase64,
      });
      return {
        initialPerception,
        finalPerception: perception,
        steps,
        termination: 'done',
        reason: action.reason,
      };
    }

    const result = await options.executor.execute(action);
    perception = result.perception;
    steps.push({
      action,
      outcome: result.outcome,
      url: perception.url,
      title: perception.title,
      a11ySnippet: perception.a11yTree.slice(0, 2_000),
      screenshotBase64: perception.screenshotBase64,
      note: result.note,
    });
  }

  return {
    initialPerception,
    finalPerception: perception,
    steps,
    termination: 'step-limit',
    reason: `Agent loop reached ${maxSteps} steps.`,
  };
}

function historyLine(step: AgentLoopStep, index: number): string {
  return `${index + 1}. ${JSON.stringify(step.action)} | ${step.outcome} | ${step.url}${
    step.note === undefined ? '' : ` | ${step.note}`
  }`;
}

function recentHistory(steps: readonly AgentLoopStep[]): string {
  const offset = Math.max(0, steps.length - 5);
  return steps
    .slice(offset)
    .map((step, index) => historyLine(step, offset + index))
    .join('\n');
}

function cumulativeSummary(steps: readonly AgentLoopStep[]): string {
  if (steps.length <= 5) return '';
  const summary = steps
    .slice(0, -5)
    .map((step, index) => historyLine(step, index))
    .join('\n');
  return summary.slice(-4_000);
}
