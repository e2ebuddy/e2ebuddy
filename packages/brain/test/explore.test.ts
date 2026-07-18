import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ActionResult, AgentAction, PagePerception } from 'shared';

import {
  explore,
  requestStructured,
  runAgentLoop,
  type AgentExecutor,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from '../src/index.js';

const initialPerception: PagePerception = {
  url: 'https://example.com/',
  title: 'Course Home',
  screenshotBase64: 'aGVsbG8=',
  a11yTree: '- heading "Courses"\n- link "Catalog"',
  interactables: [{ ref: 'e1', role: 'link', name: 'Catalog' }],
};

class FakeModelClient implements ModelClient {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly responses: Array<string | Error>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next === undefined) throw new Error('Fake model response queue is empty.');
    if (next instanceof Error) throw next;
    return { text: next, inputTokens: 10, outputTokens: 5 };
  }
}

class FakeExecutor implements AgentExecutor {
  readonly actions: AgentAction[] = [];
  private perception = initialPerception;

  async perceive(): Promise<PagePerception> {
    return this.perception;
  }

  async execute(action: AgentAction): Promise<ActionResult> {
    this.actions.push(action);
    this.perception = {
      ...this.perception,
      url: 'https://example.com/catalog',
      title: 'Course Catalog',
      a11yTree: '- heading "Course Catalog"',
      interactables: [],
    };
    return { action, outcome: 'ok', perception: this.perception };
  }
}

const understandingJson = JSON.stringify({
  productType: '在线课程网站',
  summary: '该网站提供在线课程目录。用户可以浏览课程。',
  primaryLanguage: 'zh-CN',
  pages: [
    { url: 'https://example.com/', title: 'Course Home', purpose: '展示课程入口' },
    { url: 'https://example.com/catalog', title: 'Course Catalog', purpose: '展示课程目录' },
  ],
  coreFlows: [
    {
      name: '浏览课程',
      steps: ['打开课程目录', '查看可用课程'],
      importance: 'critical',
    },
  ],
  observations: [],
});

describe('structured model output', () => {
  it('accepts a single complete JSON code fence while preserving schema validation', async () => {
    const client = new FakeModelClient(['```json\n{"ok":true}\n```']);
    await expect(
      requestStructured({
        client,
        model: 'test-model',
        purpose: 'test-fenced-json',
        system: 'Return JSON.',
        content: [{ type: 'text', text: 'Give me JSON.' }],
        schema: z.object({ ok: z.boolean() }).strict(),
        maxTokens: 100,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('retries exactly once with schema feedback', async () => {
    const client = new FakeModelClient(['not-json', '{"ok":true}']);
    const result = await requestStructured({
      client,
      model: 'test-model',
      purpose: 'test-json',
      system: 'Return JSON.',
      content: [{ type: 'text', text: 'Give me JSON.' }],
      schema: z.object({ ok: z.boolean() }).strict(),
      maxTokens: 100,
    });

    expect(result).toEqual({ ok: true });
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.messages).toHaveLength(3);
    expect(client.requests[1]?.attempt).toBe(2);
  });
});

describe('agent loop', () => {
  it('executes model actions and terminates on done', async () => {
    const client = new FakeModelClient([
      '{"type":"click","ref":"e1"}',
      '{"type":"done","reason":"understood"}',
    ]);
    const executor = new FakeExecutor();
    const result = await runAgentLoop({
      executor,
      client,
      model: 'test-model',
      system: 'Explore safely.',
      buildPrompt: (state) => `URL: ${state.url}\n${state.recentHistory}`,
    });

    expect(result.termination).toBe('done');
    expect(result.reason).toBe('understood');
    expect(executor.actions).toEqual([{ type: 'click', ref: 'e1' }]);
    expect(client.requests[0]?.messages[0]?.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
    );
    expect(client.requests[1]?.messages[0]?.content[0]).toEqual(
      expect.objectContaining({ type: 'text', text: expect.stringContaining('click') }),
    );
  });

  it('returns model-error after an invalid response and one failed retry', async () => {
    const client = new FakeModelClient(['invalid', 'still invalid']);
    const result = await runAgentLoop({
      executor: new FakeExecutor(),
      client,
      model: 'test-model',
      system: 'Explore safely.',
      buildPrompt: (state) => state.url,
    });
    expect(result.termination).toBe('model-error');
    expect(client.requests).toHaveLength(2);
  });
});

describe('explore stage', () => {
  it('instructs demo exploration to reveal reversible states without external side effects', async () => {
    const { exploreSystemPrompt } = await import('../src/prompts/explore.js');
    const prompt = exploreSystemPrompt('https://example.com');
    expect(prompt).toContain('reversible local UI states');
    expect(prompt).toContain('Do not finish after identifying only one flow');
    expect(prompt).toContain('never send messages');
  });

  it('builds a validated UnderstandingDoc from the exploration trace', async () => {
    const client = new FakeModelClient([
      '{"type":"click","ref":"e1"}',
      '{"type":"done","reason":"visited primary pages"}',
      understandingJson,
    ]);
    const executor = new FakeExecutor();
    const result = await explore(
      { targetUrl: 'https://example.com/' },
      { executor, client, model: 'test-model' },
    );

    expect(result.understanding.productType).toBe('在线课程网站');
    expect(result.understanding.pages).toHaveLength(2);
    expect(result.understanding.declaredRequirements).toBeUndefined();
    expect(client.requests.map((request) => request.purpose)).toEqual([
      'explore-action',
      'explore-action',
      'understanding-extract',
    ]);
  });

  it('extracts, deduplicates, and deterministically attaches declared requirements', async () => {
    const modelUnderstanding = JSON.stringify({
      ...JSON.parse(understandingJson),
      declaredRequirements: ['模型擅自改写的需求'],
    });
    const client = new FakeModelClient([
      '{"type":"done","reason":"home page understood"}',
      '{"requirements":["支持课程搜索","支持课程搜索"]}',
      modelUnderstanding,
    ]);
    const result = await explore(
      { targetUrl: 'https://example.com/', userBrief: '网站需要支持课程搜索。' },
      { executor: new FakeExecutor(), client, model: 'test-model' },
    );

    expect(result.understanding.declaredRequirements).toEqual(['支持课程搜索']);
    expect(client.requests.map((request) => request.purpose)).toEqual([
      'explore-action',
      'requirements-extract',
      'understanding-extract',
    ]);
  });
});
