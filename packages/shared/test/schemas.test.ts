import { describe, expect, it } from 'vitest';

import {
  ActionResultSchema,
  AgentActionSchema,
  ArtifactRefSchema,
  CreateTestRunInputSchema,
  JudgementSchema,
  PublicTestRunSchema,
  ReportSchema,
  TestPlanSchema,
  TestRunSchema,
  UnderstandingDocSchema,
  calculateHealthScore,
  validateJudgementCoverage,
  validateTestPlanCoverage,
  type Issue,
  type Judgement,
  type TestPlan,
  type UnderstandingDoc,
} from '../src/index.js';

const runId = 'a12345678901234567890123';

const understanding: UnderstandingDoc = UnderstandingDocSchema.parse({
  productType: '在线课程网站',
  summary: '用户可以浏览并购买在线课程。',
  primaryLanguage: 'zh-CN',
  pages: [{ url: 'https://example.com/', title: '首页', purpose: '展示课程' }],
  coreFlows: [
    {
      name: '购买课程',
      steps: ['打开课程', '加入购物车'],
      importance: 'critical',
    },
  ],
  declaredRequirements: ['支持课程搜索'],
  observations: [],
});

const validPlan: TestPlan = TestPlanSchema.parse({
  cases: [
    {
      id: 'search-flow',
      layer: 'flow',
      title: '搜索课程',
      steps: ['输入课程名称'],
      expected: '显示匹配的课程',
      sourceRequirements: ['支持课程搜索'],
    },
    {
      id: 'home-desktop',
      layer: 'visual',
      title: '桌面端首页',
      steps: ['查看首页'],
      expected: '布局无重叠',
      viewport: 'desktop',
    },
    {
      id: 'home-mobile',
      layer: 'visual',
      title: '移动端首页',
      steps: ['查看首页'],
      expected: '布局无溢出',
      viewport: 'mobile',
    },
    {
      id: 'home-content',
      layer: 'content',
      title: '首页内容',
      steps: ['检查首页文案与数值'],
      expected: '没有占位文案或数值矛盾',
    },
  ],
  untestedRequirements: [],
  untestedNotes: [],
});

const confirmedIssue: Issue = {
  id: 'issue-major',
  layer: 'flow',
  severity: 'major',
  confidence: 0.9,
  title: '搜索无响应',
  detail: '点击搜索按钮后页面没有变化。',
  reproSteps: ['打开首页', '点击搜索'],
  evidenceScreenshots: ['evidence-1.jpg'],
  pageUrl: 'https://example.com/',
  fixPrompt: '修复搜索按钮，同时保持其他功能不变。',
};

const reviewIssue: Issue = {
  id: 'issue-review',
  layer: 'content',
  severity: 'suggestion',
  confidence: 0.5,
  title: '文案可能不清晰',
  detail: '这段文案可能需要人工确认。',
  reproSteps: ['打开首页'],
  evidenceScreenshots: ['evidence-2.jpg'],
  pageUrl: 'https://example.com/',
  fixPrompt: '确认文案是否需要调整。',
};

describe('API boundary schemas', () => {
  it('accepts a valid run request and rejects unsafe protocols or unknown keys', () => {
    expect(
      CreateTestRunInputSchema.parse({
        targetUrl: 'https://example.com',
        credentials: { username: 'tester', password: 'secret' },
      }),
    ).toBeTruthy();

    expect(() => CreateTestRunInputSchema.parse({ targetUrl: 'file:///etc/passwd' })).toThrow();
    expect(() =>
      CreateTestRunInputSchema.parse({ targetUrl: 'https://example.com', admin: true }),
    ).toThrow();
  });

  it('keeps Date in the domain model and ISO strings in the public API', () => {
    const domainRun = TestRunSchema.parse({
      id: runId,
      targetUrl: 'https://example.com',
      status: 'queued',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      credentialsCiphertext: 'v1:ciphertext',
    });
    expect(domainRun.createdAt).toBeInstanceOf(Date);

    const publicRun = PublicTestRunSchema.parse({
      id: runId,
      targetUrl: domainRun.targetUrl,
      status: domainRun.status,
      createdAt: domainRun.createdAt.toISOString(),
    });
    expect(publicRun.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(() =>
      PublicTestRunSchema.parse({ ...publicRun, credentialsCiphertext: 'must-not-leak' }),
    ).toThrow();
  });
});

describe('action and artifact schemas', () => {
  it('enforces wait and type limits', () => {
    expect(AgentActionSchema.parse({ type: 'wait', ms: 5_000 })).toEqual({
      type: 'wait',
      ms: 5_000,
    });
    expect(() => AgentActionSchema.parse({ type: 'wait', ms: 5_001 })).toThrow();
    expect(() =>
      AgentActionSchema.parse({ type: 'type', ref: 'e1', text: 'x'.repeat(5_001) }),
    ).toThrow();
  });

  it('validates a complete action result', () => {
    const result = ActionResultSchema.parse({
      action: { type: 'click', ref: 'e1' },
      outcome: 'ok',
      perception: {
        url: 'https://example.com/',
        title: 'Example',
        screenshotBase64: 'aGVsbG8=',
        a11yTree: '- heading "Example"',
        interactables: [{ ref: 'e1', role: 'button', name: 'Continue' }],
      },
    });
    expect(result.outcome).toBe('ok');
  });

  it('rejects artifact path traversal', () => {
    expect(
      ArtifactRefSchema.parse({ key: 'shot_123.jpg', contentType: 'image/jpeg', byteSize: 42 }),
    ).toBeTruthy();
    expect(() =>
      ArtifactRefSchema.parse({ key: '../secret.jpg', contentType: 'image/jpeg', byteSize: 42 }),
    ).toThrow();
  });
});

describe('test planning contracts', () => {
  it('enforces the twelve-case hard limit', () => {
    const cases = Array.from({ length: 13 }, (_, index) => ({
      id: `case-${index}`,
      layer: 'content',
      title: `Case ${index}`,
      steps: ['Inspect page'],
      expected: 'Content is valid',
    }));
    expect(() =>
      TestPlanSchema.parse({ cases, untestedRequirements: [], untestedNotes: [] }),
    ).toThrow();
  });

  it('requires desktop/mobile visual coverage and exact requirement accounting', () => {
    expect(validateTestPlanCoverage(validPlan, understanding)).toEqual([]);

    const incompletePlan = TestPlanSchema.parse({
      cases: validPlan.cases.filter(
        (testCase) => testCase.viewport !== 'mobile' && testCase.id !== 'search-flow',
      ),
      untestedRequirements: [],
      untestedNotes: [],
    });
    expect(validateTestPlanCoverage(incompletePlan, understanding)).toEqual(
      expect.arrayContaining([
        'Test plan must include a mobile visual case.',
        'Declared requirement must be mapped exactly once: 支持课程搜索',
      ]),
    );
  });
});

describe('judgement and report contracts', () => {
  const judgement: Judgement = {
    caseResults: [
      { caseId: 'search-flow', status: 'failed', summary: '搜索失败', issueIds: ['issue-major'] },
      { caseId: 'home-desktop', status: 'passed', summary: '桌面布局正常', issueIds: [] },
      {
        caseId: 'home-mobile',
        status: 'needs-review',
        summary: '需要人工检查文案',
        issueIds: ['issue-review'],
      },
      { caseId: 'home-content', status: 'passed', summary: '首页内容正常', issueIds: [] },
    ],
    confirmedIssues: [confirmedIssue],
    needsHumanReview: [reviewIssue],
  };

  it('partitions issues by confidence and covers every planned case', () => {
    expect(JudgementSchema.parse(judgement)).toBeTruthy();
    expect(validateJudgementCoverage(judgement, validPlan)).toEqual([]);

    expect(() =>
      JudgementSchema.parse({
        ...judgement,
        confirmedIssues: [{ ...confirmedIssue, confidence: 0.69 }],
      }),
    ).toThrow();
  });

  it('calculates health from confirmed issues only', () => {
    expect(calculateHealthScore([confirmedIssue])).toBe(90);

    const report = ReportSchema.parse({
      healthScore: 90,
      verdict: '核心搜索流程需要修复。',
      issues: [confirmedIssue],
      needsHumanReview: [reviewIssue],
      coverage: { testedFlows: ['搜索课程'], untestedNotes: [] },
      combinedFixPrompt: '修复搜索流程，不要改动已通过的桌面布局。',
    });
    expect(report.healthScore).toBe(90);
    expect(() => ReportSchema.parse({ ...report, healthScore: 88 })).toThrow();
  });
});
