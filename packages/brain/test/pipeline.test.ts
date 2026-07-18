import { describe, expect, it } from 'vitest';

import type {
  ActionResult,
  AgentAction,
  ArtifactRef,
  Issue,
  PagePerception,
  TestPlan,
  UnderstandingDoc,
} from 'shared';
import type { StorageAdapter } from 'storage';

import {
  composeReport,
  deduplicateIssues,
  executePlan,
  generatePlan,
  judgeRun,
  shouldUseTrustedLogin,
  type AgentExecutor,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from '../src/index.js';

class QueueModel implements ModelClient {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly outputs: string[]) {}
  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const text = this.outputs.shift();
    if (text === undefined) throw new Error('No queued model output.');
    return { text, inputTokens: 1, outputTokens: 1 };
  }
}

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, Uint8Array>();
  private sequence = 0;
  async put(data: Uint8Array): Promise<ArtifactRef> {
    this.sequence += 1;
    const key = `artifact-${this.sequence}.jpg`;
    this.values.set(key, data);
    return { key, contentType: 'image/jpeg', byteSize: data.byteLength };
  }
  async get(_runId: string, key: string): Promise<Uint8Array> {
    const value = this.values.get(key);
    if (value === undefined) throw new Error('Missing artifact.');
    return value;
  }
  async deleteRun(): Promise<void> {
    this.values.clear();
  }
}

const understanding: UnderstandingDoc = {
  productType: 'Todo app',
  summary: 'Users manage tasks.',
  primaryLanguage: 'en',
  pages: [{ url: 'https://example.com/', title: 'Todo', purpose: 'Manage tasks' }],
  coreFlows: [{ name: 'Add task', steps: ['Enter task'], importance: 'critical' }],
  declaredRequirements: ['Users can add tasks'],
  observations: [],
};

const plan: TestPlan = {
  cases: [
    {
      id: 'flow-add',
      layer: 'flow',
      title: 'Add task',
      steps: ['Enter a task'],
      expected: 'Task appears',
      sourceRequirements: ['Users can add tasks'],
    },
    {
      id: 'visual-desktop',
      layer: 'visual',
      title: 'Desktop layout',
      steps: ['Open homepage'],
      expected: 'Layout is intact',
      viewport: 'desktop',
    },
    {
      id: 'visual-mobile',
      layer: 'visual',
      title: 'Mobile layout',
      steps: ['Open homepage'],
      expected: 'Layout is intact',
      viewport: 'mobile',
    },
    {
      id: 'content-home',
      layer: 'content',
      title: 'Homepage content',
      steps: ['Inspect homepage content'],
      expected: 'No placeholders or numeric contradictions',
    },
  ],
  untestedRequirements: [],
  untestedNotes: [],
};

const perception: PagePerception = {
  url: 'https://example.com/',
  title: 'Todo',
  screenshotBase64: 'aW1hZ2U=',
  a11yTree: '- heading "Todo"',
  interactables: [],
};

class StaticExecutor implements AgentExecutor {
  async perceive(): Promise<PagePerception> {
    return perception;
  }
  async execute(action: AgentAction): Promise<ActionResult> {
    return { action, outcome: 'ok', perception };
  }
}

describe('M3/M4 pipeline', () => {
  it('keeps login-page inspections unauthenticated while authenticating dashboard cases', () => {
    expect(shouldUseTrustedLogin({
      id: 'visual-login',
      layer: 'visual',
      title: 'Login page on mobile',
      steps: ['Open the login page'],
      expected: 'Login form is visible without clipping',
      viewport: 'mobile',
    })).toBe(false);
    expect(shouldUseTrustedLogin({
      id: 'content-dashboard',
      layer: 'content',
      title: 'Dashboard statistics',
      steps: ['Log in to the dashboard', 'Inspect totals'],
      expected: 'Dashboard totals are consistent',
    })).toBe(true);
  });

  it('deduplicates repeated root causes while preserving distinct placeholder defects', () => {
    const base: Issue = {
      id: 'arithmetic-1',
      layer: 'content',
      severity: 'major',
      confidence: 0.9,
      title: 'Incorrect total calculation',
      detail: 'Two items at $25 show a mathematically incorrect $40 total.',
      reproSteps: ['Open the page'],
      evidenceScreenshots: [],
      pageUrl: 'https://example.com/',
      fixPrompt: 'Correct the total.',
    };
    const issues = deduplicateIssues([
      base,
      { ...base, id: 'arithmetic-2', confidence: 0.98, title: 'Arithmetic error in total' },
      {
        ...base,
        id: 'lorem',
        title: 'Lorem ipsum placeholder',
        detail: 'Lorem ipsum is visible.',
      },
      {
        ...base,
        id: 'todo',
        title: 'TODO placeholder',
        detail: 'TODO content is visible.',
      },
    ]);

    expect(issues.map((issue) => issue.id)).toEqual(['arithmetic-2', 'lorem', 'todo']);
  });

  it('retries a structurally valid plan that fails deterministic coverage', async () => {
    const invalid = JSON.stringify({
      cases: [],
      untestedRequirements: ['Users can add tasks'],
      untestedNotes: [],
    });
    const model = new QueueModel([invalid, JSON.stringify(plan)]);
    await expect(generatePlan(understanding, { client: model, model: 'test' })).resolves.toEqual(plan);
    expect(model.requests).toHaveLength(2);
  });

  it('moves requirements mapped to the wrong layer into untested requirements', async () => {
    const wronglyMapped: TestPlan = {
      ...plan,
      cases: plan.cases.map((testCase) => testCase.id === 'flow-add'
        ? { ...testCase, sourceRequirements: [] }
        : testCase.id === 'content-home'
          ? { ...testCase, sourceRequirements: ['Users can add tasks'] }
          : testCase),
    };
    const model = new QueueModel([JSON.stringify(wronglyMapped)]);
    const normalized = await generatePlan(understanding, { client: model, model: 'test' });

    expect(normalized.untestedRequirements).toEqual(['Users can add tasks']);
    expect(normalized.cases.flatMap((testCase) => testCase.sourceRequirements ?? [])).toEqual([]);
    expect(model.requests).toHaveLength(1);
  });

  it('executes isolated cases, stores evidence, judges, and composes deterministic score', async () => {
    const storage = new MemoryStorage();
    const executeModel = new QueueModel(
      plan.cases.map(() => '{"type":"done","reason":"Observed expected state"}'),
    );
    let sessions = 0;
    const execution = await executePlan(
      { runId: 'r123456789012345678901234', targetUrl: 'https://example.com/', plan },
      {
        client: executeModel,
        model: 'test',
        storage,
        createSession: async () => {
          sessions += 1;
          return { executor: new StaticExecutor(), finish: async () => undefined };
        },
      },
    );
    expect(sessions).toBe(4);
    expect(execution.evidence.steps).toHaveLength(8);
    expect(execution.evidence.steps[0]).toMatchObject({
      stepIndex: 0,
      note: 'Before-action evidence.',
    });

    const issueKey = execution.evidence.steps[0]?.screenshotKey;
    expect(issueKey).toBeDefined();
    const noIssues = JSON.stringify({ summary: 'Passed.', issues: [] });
    const judgeModel = new QueueModel([
      JSON.stringify({
        summary: 'Add button did nothing.',
        issues: [
          {
            id: 'dead-add',
            layer: 'flow',
            severity: 'major',
            confidence: 0.9,
            title: 'Add action has no effect',
            detail: 'The expected task was not shown.',
            reproSteps: ['Open app', 'Add task'],
            evidenceScreenshots: [issueKey],
            pageUrl: 'https://example.com/',
            fixPrompt: 'Wire the add action to create and render a task.',
          },
        ],
      }),
      noIssues,
      noIssues,
      noIssues,
    ]);
    const judgement = await judgeRun(
      { runId: 'r123456789012345678901234', understanding, plan, evidence: execution.evidence },
      { client: judgeModel, model: 'test', storage },
    );
    expect(judgement.confirmedIssues).toHaveLength(1);

    const reportModel = new QueueModel([
      '{"verdict":"One major issue.","combinedFixPrompt":"Fix the add action. Protect passed visual layouts."}',
    ]);
    const report = await composeReport(
      { understanding, plan, evidence: execution.evidence, judgement },
      { client: reportModel, model: 'test' },
    );
    expect(report.healthScore).toBe(90);
    expect(report.issues[0]?.id).toBe('dead-add');
  });
});
