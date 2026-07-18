import { z } from 'zod';

const MAX_URL_LENGTH = 2_048;
const MAX_BRIEF_LENGTH = 50_000;
const MAX_ACTION_TEXT_LENGTH = 5_000;
const MAX_A11Y_LENGTH = 8_000;

export const Cuid2Schema = z
  .string()
  .min(24)
  .max(128)
  .regex(/^[a-z][a-z0-9]*$/, 'Expected a cuid2-compatible identifier');

export const IdSchema = z.string().trim().min(1).max(128);

export const HttpUrlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'Only http and https URLs are allowed');

export const ArtifactKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/, 'Expected a single opaque artifact basename');

export const RunStatusSchema = z.enum([
  'queued',
  'exploring',
  'planning',
  'executing',
  'judging',
  'reporting',
  'done',
  'failed',
]);

export const CheckLayerSchema = z.enum(['flow', 'content', 'visual']);
export const SeveritySchema = z.enum(['blocker', 'major', 'suggestion']);
export const CaseStatusSchema = z.enum([
  'passed',
  'failed',
  'needs-review',
  'blocked',
  'untested',
]);
export const ActionOutcomeSchema = z.enum(['ok', 'no-visible-change', 'error', 'blocked']);

export const LoginCredentialsSchema = z
  .object({
    username: z.string().min(1).max(512),
    password: z.string().min(1).max(2_048),
  })
  .strict();

export const CreateTestRunInputSchema = z
  .object({
    targetUrl: HttpUrlSchema,
    userBrief: z.string().max(MAX_BRIEF_LENGTH).optional(),
    credentials: LoginCredentialsSchema.optional(),
  })
  .strict();

const NavigateActionSchema = z.object({ type: z.literal('navigate'), url: HttpUrlSchema }).strict();
const ClickActionSchema = z.object({ type: z.literal('click'), ref: IdSchema }).strict();
const TypeActionSchema = z
  .object({
    type: z.literal('type'),
    ref: IdSchema,
    text: z.string().max(MAX_ACTION_TEXT_LENGTH),
    pressEnter: z.boolean().optional(),
  })
  .strict();
const ScrollActionSchema = z
  .object({ type: z.literal('scroll'), direction: z.enum(['down', 'up']) })
  .strict();
const SelectActionSchema = z
  .object({ type: z.literal('select'), ref: IdSchema, value: z.string().max(MAX_ACTION_TEXT_LENGTH) })
  .strict();
const WaitActionSchema = z
  .object({ type: z.literal('wait'), ms: z.number().int().min(0).max(5_000) })
  .strict();
const SetViewportActionSchema = z
  .object({ type: z.literal('setViewport'), preset: z.enum(['desktop', 'mobile']) })
  .strict();
const DoneActionSchema = z
  .object({ type: z.literal('done'), reason: z.string().trim().min(1).max(2_000) })
  .strict();

export const AgentActionSchema = z.discriminatedUnion('type', [
  NavigateActionSchema,
  ClickActionSchema,
  TypeActionSchema,
  ScrollActionSchema,
  SelectActionSchema,
  WaitActionSchema,
  SetViewportActionSchema,
  DoneActionSchema,
]);

export const UnderstandingDocSchema = z
  .object({
    productType: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(5_000),
    primaryLanguage: z.string().trim().min(2).max(35),
    pages: z
      .array(
        z
          .object({
            url: HttpUrlSchema,
            title: z.string().max(1_000),
            purpose: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .max(8),
    coreFlows: z.array(
      z
        .object({
          name: z.string().trim().min(1).max(500),
          steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
          importance: z.enum(['critical', 'important', 'nice-to-have']),
        })
        .strict(),
    ),
    declaredRequirements: z.array(z.string().trim().min(1).max(5_000)).optional(),
    observations: z.array(z.string().trim().min(1).max(5_000)),
  })
  .strict();

export const TestCaseSchema = z
  .object({
    id: IdSchema,
    layer: CheckLayerSchema,
    title: z.string().trim().min(1).max(500),
    steps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
    expected: z.string().trim().min(1).max(5_000),
    viewport: z.enum(['desktop', 'mobile']).optional(),
    sourceRequirements: z.array(z.string().trim().min(1).max(5_000)).optional(),
  })
  .strict();

export const TestPlanSchema = z
  .object({
    cases: z.array(TestCaseSchema).max(12),
    untestedRequirements: z.array(z.string().trim().min(1).max(5_000)),
    untestedNotes: z.array(z.string().trim().min(1).max(5_000)),
  })
  .strict()
  .superRefine((plan, context) => {
    const caseIds = new Set<string>();
    for (const testCase of plan.cases) {
      if (caseIds.has(testCase.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate test case id: ${testCase.id}`,
          path: ['cases'],
        });
      }
      caseIds.add(testCase.id);

      const requirements = testCase.sourceRequirements ?? [];
      if (new Set(requirements).size !== requirements.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate source requirement in case: ${testCase.id}`,
          path: ['cases'],
        });
      }
    }

    if (new Set(plan.untestedRequirements).size !== plan.untestedRequirements.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate untested requirement',
        path: ['untestedRequirements'],
      });
    }
  });

export const InteractableSchema = z
  .object({
    ref: IdSchema,
    role: z.string().trim().min(1).max(128),
    name: z.string().max(2_000),
    options: z
      .array(z.object({ label: z.string().max(2_000), value: z.string().max(2_000) }).strict())
      .optional(),
  })
  .strict();

export const PagePerceptionSchema = z
  .object({
    url: HttpUrlSchema,
    title: z.string().max(1_000),
    screenshotBase64: z.string().min(1),
    a11yTree: z.string().max(MAX_A11Y_LENGTH),
    interactables: z.array(InteractableSchema),
  })
  .strict();

export const ActionResultSchema = z
  .object({
    action: AgentActionSchema,
    outcome: ActionOutcomeSchema,
    perception: PagePerceptionSchema,
    note: z.string().max(5_000).optional(),
  })
  .strict();

export const ArtifactRefSchema = z
  .object({
    key: ArtifactKeySchema,
    contentType: z.string().trim().min(1).max(255),
    byteSize: z.number().int().nonnegative(),
  })
  .strict();

export const StepEvidenceSchema = z
  .object({
    caseId: IdSchema,
    stepIndex: z.number().int().nonnegative(),
    action: AgentActionSchema,
    screenshotKey: ArtifactKeySchema,
    a11ySnippet: z.string().max(MAX_A11Y_LENGTH),
    urlAfter: HttpUrlSchema,
    outcome: ActionOutcomeSchema,
    note: z.string().max(5_000).optional(),
  })
  .strict();

export const EvidencePackSchema = z
  .object({
    steps: z.array(StepEvidenceSchema),
    videoKeys: z.record(ArtifactKeySchema),
  })
  .strict();

export const IssueSchema = z
  .object({
    id: IdSchema,
    layer: z.union([CheckLayerSchema, z.literal('missing-feature')]),
    severity: SeveritySchema,
    confidence: z.number().min(0).max(1),
    title: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(10_000),
    reproSteps: z.array(z.string().trim().min(1).max(2_000)),
    evidenceScreenshots: z.array(ArtifactKeySchema),
    pageUrl: HttpUrlSchema,
    fixPrompt: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const CaseResultSchema = z
  .object({
    caseId: IdSchema,
    status: CaseStatusSchema,
    summary: z.string().trim().min(1).max(5_000),
    issueIds: z.array(IdSchema),
  })
  .strict();

function addIssuePartitionErrors(
  confirmedIssues: readonly z.infer<typeof IssueSchema>[],
  needsHumanReview: readonly z.infer<typeof IssueSchema>[],
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();

  for (const issue of confirmedIssues) {
    if (issue.confidence < 0.7) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Confirmed issue ${issue.id} must have confidence >= 0.7`,
      });
    }
    if (ids.has(issue.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate issue id: ${issue.id}` });
    }
    ids.add(issue.id);
  }

  for (const issue of needsHumanReview) {
    if (issue.confidence >= 0.7 || issue.severity !== 'suggestion') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Human-review issue ${issue.id} must have confidence < 0.7 and suggestion severity`,
      });
    }
    if (ids.has(issue.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate issue id: ${issue.id}` });
    }
    ids.add(issue.id);
  }
}

export const JudgementSchema = z
  .object({
    caseResults: z.array(CaseResultSchema),
    confirmedIssues: z.array(IssueSchema),
    needsHumanReview: z.array(IssueSchema),
  })
  .strict()
  .superRefine((judgement, context) => {
    addIssuePartitionErrors(judgement.confirmedIssues, judgement.needsHumanReview, context);

    const caseIds = new Set<string>();
    const knownIssueIds = new Set(
      [...judgement.confirmedIssues, ...judgement.needsHumanReview].map((issue) => issue.id),
    );
    for (const result of judgement.caseResults) {
      if (caseIds.has(result.caseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate case result: ${result.caseId}`,
        });
      }
      caseIds.add(result.caseId);
      for (const issueId of result.issueIds) {
        if (!knownIssueIds.has(issueId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Case ${result.caseId} references unknown issue ${issueId}`,
          });
        }
      }
    }
  });

const severityRank: Record<z.infer<typeof SeveritySchema>, number> = {
  blocker: 0,
  major: 1,
  suggestion: 2,
};

function scoreIssues(issues: readonly z.infer<typeof IssueSchema>[]): number {
  const deduction = issues.reduce((total, issue) => {
    const weights: Record<z.infer<typeof SeveritySchema>, number> = {
      blocker: 25,
      major: 10,
      suggestion: 2,
    };
    return total + weights[issue.severity];
  }, 0);
  return Math.max(0, 100 - deduction);
}

export const ReportSchema = z
  .object({
    healthScore: z.number().int().min(0).max(100),
    verdict: z.string().trim().min(1).max(2_000),
    issues: z.array(IssueSchema),
    needsHumanReview: z.array(IssueSchema),
    coverage: z
      .object({
        testedFlows: z.array(z.string().trim().min(1).max(2_000)),
        untestedNotes: z.array(z.string().trim().min(1).max(5_000)),
      })
      .strict(),
    combinedFixPrompt: z.string().trim().min(1).max(100_000),
  })
  .strict()
  .superRefine((report, context) => {
    addIssuePartitionErrors(report.issues, report.needsHumanReview, context);
    if (report.healthScore !== scoreIssues(report.issues)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'healthScore does not match confirmed issue deductions',
        path: ['healthScore'],
      });
    }
    for (let index = 1; index < report.issues.length; index += 1) {
      const previous = report.issues[index - 1];
      const current = report.issues[index];
      if (previous !== undefined && current !== undefined) {
        if (severityRank[previous.severity] > severityRank[current.severity]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Confirmed issues must be sorted by severity',
            path: ['issues', index],
          });
        }
      }
    }
  });

export const TestRunSchema = z
  .object({
    id: Cuid2Schema,
    targetUrl: HttpUrlSchema,
    userBrief: z.string().max(MAX_BRIEF_LENGTH).optional(),
    credentialsCiphertext: z.string().min(1).max(20_000).optional(),
    status: RunStatusSchema,
    createdAt: z.date(),
    understanding: UnderstandingDocSchema.optional(),
    plan: TestPlanSchema.optional(),
    evidence: EvidencePackSchema.optional(),
    judgement: JudgementSchema.optional(),
    report: ReportSchema.optional(),
    error: z.string().max(10_000).optional(),
  })
  .strict();

export const PublicTestRunSchema = z
  .object({
    id: Cuid2Schema,
    targetUrl: HttpUrlSchema,
    status: RunStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    report: ReportSchema.optional(),
    error: z.string().max(2_000).optional(),
  })
  .strict();

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CheckLayer = z.infer<typeof CheckLayerSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type CaseStatus = z.infer<typeof CaseStatusSchema>;
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;
export type LoginCredentials = z.infer<typeof LoginCredentialsSchema>;
export type CreateTestRunInput = z.infer<typeof CreateTestRunInputSchema>;
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type UnderstandingDoc = z.infer<typeof UnderstandingDocSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestPlan = z.infer<typeof TestPlanSchema>;
export type Interactable = z.infer<typeof InteractableSchema>;
export type PagePerception = z.infer<typeof PagePerceptionSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type StepEvidence = z.infer<typeof StepEvidenceSchema>;
export type EvidencePack = z.infer<typeof EvidencePackSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type CaseResult = z.infer<typeof CaseResultSchema>;
export type Judgement = z.infer<typeof JudgementSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type TestRun = z.infer<typeof TestRunSchema>;
export type PublicTestRun = z.infer<typeof PublicTestRunSchema>;
