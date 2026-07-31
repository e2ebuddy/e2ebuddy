import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  toolDoctor,
  toolListRuns,
  toolReport,
  toolRun,
  toolSetup,
  toolStatus,
} from './tools.js';

/**
 * Start e2ebuddy as an MCP server on stdio.
 * Logs go to stderr only — stdout is reserved for the MCP protocol.
 */
export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    {
      name: 'e2ebuddy',
      version: '0.1.1',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        'e2ebuddy runs AI-powered web acceptance tests locally (no Redis/Docker). ' +
        'Typical flow: e2ebuddy_doctor → e2ebuddy_run → e2ebuddy_report. ' +
        'Runs may take several minutes when the brain pipeline is active.',
    },
  );

  server.registerTool(
    'e2ebuddy_doctor',
    {
      title: 'Doctor',
      description:
        'Diagnose the local e2ebuddy environment: Node, Playwright browser, data dirs, AI config presence (never returns API keys).',
    },
    async () => toolDoctor(),
  );

  server.registerTool(
    'e2ebuddy_setup',
    {
      title: 'Setup',
      description:
        'Idempotent first-run setup: create user data directories and ensure Playwright Chromium is installed.',
    },
    async () => toolSetup(),
  );

  server.registerTool(
    'e2ebuddy_run',
    {
      title: 'Run acceptance',
      description:
        'Start an acceptance run against a public HTTP(S) URL. ' +
        'Uses the local brain pipeline (explore→plan→execute→judge→report) when AI keys are configured, otherwise a demo pipeline. ' +
        'By default waits until the run finishes (can take minutes). Set wait=false to return a runId immediately and poll with e2ebuddy_status.',
      inputSchema: {
        targetUrl: z
          .string()
          .url()
          .describe('Target product URL to accept (http or https)'),
        userBrief: z
          .string()
          .max(8_000)
          .optional()
          .describe('Product / acceptance requirements in natural language'),
        wait: z
          .boolean()
          .optional()
          .describe('Wait for completion (default true). If false, returns runId for polling.'),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .max(3_600_000)
          .optional()
          .describe('Max wait time in ms when wait=true (default 600000)'),
      },
    },
    async (args) =>
      toolRun({
        targetUrl: args.targetUrl,
        userBrief: args.userBrief,
        wait: args.wait,
        timeoutMs: args.timeoutMs,
      }),
  );

  server.registerTool(
    'e2ebuddy_status',
    {
      title: 'Run status',
      description: 'Get status, error, report summary, and recent events for a runId.',
      inputSchema: {
        runId: z.string().min(1).describe('Run id returned by e2ebuddy_run'),
        includeEvents: z
          .boolean()
          .optional()
          .describe('Include recent events (default true)'),
      },
    },
    async (args) =>
      toolStatus({
        runId: args.runId,
        includeEvents: args.includeEvents,
      }),
  );

  server.registerTool(
    'e2ebuddy_report',
    {
      title: 'Run report',
      description:
        'Fetch the acceptance report for a run as Markdown and/or JSON (issues, verdict, fix prompts).',
      inputSchema: {
        runId: z.string().min(1).describe('Run id'),
        format: z
          .enum(['markdown', 'json', 'both'])
          .optional()
          .describe('Output format (default both)'),
      },
    },
    async (args) =>
      toolReport({
        runId: args.runId,
        format: args.format,
      }),
  );

  server.registerTool(
    'e2ebuddy_list_runs',
    {
      title: 'List runs',
      description: 'List recent local acceptance runs (newest first).',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('Max runs (default 20)'),
      },
    },
    async (args) => toolListRuns({ limit: args.limit }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('e2ebuddy MCP server listening on stdio\n');
}
