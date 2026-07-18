import { createId } from '@paralleldrive/cuid2';
import { PrismaClient, type Prisma, type TestRun as PrismaTestRun } from '@prisma/client';
import {
  TestRunSchema,
  type CreateTestRunInput,
  type RunStatus,
  type TestRun,
} from 'shared';

export type StageField = 'understanding' | 'plan' | 'evidence' | 'judgement' | 'report';

export interface StageUpdate {
  field: StageField;
  value: unknown;
  status: RunStatus;
  metrics?: unknown;
}

export class TestRunRepository {
  constructor(readonly prisma: PrismaClient) {}

  async create(input: CreateTestRunInput, credentialsCiphertext?: string): Promise<TestRun> {
    const row = await this.prisma.testRun.create({
      data: {
        id: createId(),
        targetUrl: input.targetUrl,
        userBrief: input.userBrief,
        credentialsCiphertext,
        status: 'queued',
      },
    });
    return mapTestRun(row);
  }

  async find(id: string): Promise<TestRun | undefined> {
    const row = await this.prisma.testRun.findUnique({ where: { id } });
    return row === null ? undefined : mapTestRun(row);
  }

  async saveStage(id: string, update: StageUpdate): Promise<TestRun> {
    const data: Prisma.TestRunUpdateInput = {
      status: update.status,
      error: null,
      [update.field]: toJson(update.value),
    };
    if (update.metrics !== undefined) data.metrics = toJson(update.metrics);
    const row = await this.prisma.$transaction(async (transaction) =>
      transaction.testRun.update({ where: { id }, data }),
    );
    return mapTestRun(row);
  }

  async setStatus(id: string, status: RunStatus): Promise<void> {
    await this.prisma.testRun.update({ where: { id }, data: { status } });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.prisma.testRun.update({
      where: { id },
      data: { status: 'failed', error: error.slice(0, 10_000), credentialsCiphertext: null },
    });
  }

  async clearCredentials(id: string): Promise<void> {
    await this.prisma.testRun.update({ where: { id }, data: { credentialsCiphertext: null } });
  }
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapTestRun(row: PrismaTestRun): TestRun {
  return TestRunSchema.parse({
    id: row.id,
    targetUrl: row.targetUrl,
    userBrief: row.userBrief ?? undefined,
    credentialsCiphertext: row.credentialsCiphertext ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    understanding: row.understanding ?? undefined,
    plan: row.plan ?? undefined,
    evidence: row.evidence ?? undefined,
    judgement: row.judgement ?? undefined,
    report: row.report ?? undefined,
    error: row.error ?? undefined,
  });
}
