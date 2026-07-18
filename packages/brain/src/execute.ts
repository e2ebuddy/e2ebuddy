import {
  EvidencePackSchema,
  LoginCredentialsSchema,
  type EvidencePack,
  type LoginCredentials,
  type TestCase,
  type TestPlan,
} from 'shared';
import type { StorageAdapter } from 'storage';

import { runAgentLoop, type AgentExecutor, type AgentLoopResult } from './agent-loop.js';
import type { ModelClient } from './model.js';
import { executeActionPrompt, executeSystemPrompt } from './prompts/execute.js';

export interface ExecutionSession {
  executor: AgentExecutor;
  trustedLogin?: (credentials: LoginCredentials) => Promise<{ success: boolean; note: string }>;
  finish(): Promise<Uint8Array | undefined>;
}

export interface ExecuteDependencies {
  client: ModelClient;
  model: string;
  storage: StorageAdapter;
  createSession(testCase: TestCase): Promise<ExecutionSession>;
}

export interface ExecuteInput {
  runId: string;
  targetUrl: string;
  plan: TestPlan;
  credentials?: LoginCredentials;
}

export interface ExecuteResult {
  evidence: EvidencePack;
  loops: Record<string, AgentLoopResult | { termination: 'blocked'; reason: string }>;
}

export async function executePlan(
  input: ExecuteInput,
  dependencies: ExecuteDependencies,
): Promise<ExecuteResult> {
  const credentials =
    input.credentials === undefined ? undefined : LoginCredentialsSchema.parse(input.credentials);
  const steps: EvidencePack['steps'] = [];
  const videoKeys: Record<string, string> = {};
  const loops: ExecuteResult['loops'] = {};

  for (const testCase of input.plan.cases) {
    const session = await dependencies.createSession(testCase);
    try {
      if (credentials !== undefined && session.trustedLogin !== undefined) {
        const login = await session.trustedLogin(credentials);
        if (!login.success) {
          loops[testCase.id] = { termination: 'blocked', reason: login.note };
          const perception = await session.executor.perceive();
          const screenshot = await storeScreenshot(
            dependencies.storage,
            input.runId,
            perception.screenshotBase64,
          );
          steps.push({
            caseId: testCase.id,
            stepIndex: 0,
            action: { type: 'done', reason: login.note },
            screenshotKey: screenshot,
            a11ySnippet: perception.a11yTree,
            urlAfter: perception.url,
            outcome: 'blocked',
            note: login.note,
          });
          continue;
        }
      }

      const loop = await runAgentLoop({
        executor: session.executor,
        client: dependencies.client,
        model: dependencies.model,
        system: executeSystemPrompt(testCase, new URL(input.targetUrl).origin),
        buildPrompt: executeActionPrompt,
        purpose: `execute-${testCase.layer}`,
        maxSteps: 25,
        timeoutMs: 180_000,
      });
      loops[testCase.id] = loop;
      for (const [index, step] of loop.steps.entries()) {
        const screenshotKey = await storeScreenshot(
          dependencies.storage,
          input.runId,
          step.screenshotBase64,
        );
        steps.push({
          caseId: testCase.id,
          stepIndex: index,
          action: step.action,
          screenshotKey,
          a11ySnippet: step.a11ySnippet,
          urlAfter: step.url,
          outcome: step.outcome,
          note: step.note,
        });
      }
    } finally {
      const video = await session.finish();
      if (video !== undefined) {
        const artifact = await dependencies.storage.put(video, {
          runId: input.runId,
          contentType: 'video/webm',
          extension: 'webm',
        });
        videoKeys[testCase.id] = artifact.key;
      }
    }
  }

  return { evidence: EvidencePackSchema.parse({ steps, videoKeys }), loops };
}

async function storeScreenshot(
  storage: StorageAdapter,
  runId: string,
  screenshotBase64: string,
): Promise<string> {
  const artifact = await storage.put(Buffer.from(screenshotBase64, 'base64'), {
    runId,
    contentType: 'image/jpeg',
    extension: 'jpg',
  });
  return artifact.key;
}
