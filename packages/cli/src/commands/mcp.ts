import { startMcpServer } from '../mcp/server.js';

export function printMcpHelp(): void {
  process.stdout.write(`e2ebuddy mcp

Run e2ebuddy as a Model Context Protocol (MCP) server over stdio.

Usage:
  e2ebuddy mcp

Tools:
  e2ebuddy_doctor      Environment diagnostics
  e2ebuddy_setup       Prepare data dirs + Playwright Chromium
  e2ebuddy_run         Start acceptance (URL + brief)
  e2ebuddy_status      Poll run status / events
  e2ebuddy_report      Markdown + structured report
  e2ebuddy_list_runs   Recent runs

Cursor / Claude Desktop example (mcp.json):

  {
    "mcpServers": {
      "e2ebuddy": {
        "command": "e2ebuddy",
        "args": ["mcp"],
        "env": {
          "AI_PROVIDER": "openai-compatible",
          "AI_API_KEY": "…",
          "AI_BASE_URL": "https://…/v1",
          "AI_AGENT_MODEL": "…",
          "AI_VISION_MODEL": "…",
          "AI_REPORT_MODEL": "…"
        }
      }
    }
  }

From a monorepo checkout without global install:

  {
    "mcpServers": {
      "e2ebuddy": {
        "command": "pnpm",
        "args": ["-F", "e2ebuddy", "exec", "node", "dist/cli.js", "mcp"],
        "cwd": "/absolute/path/to/e2ebuddy"
      }
    }
  }

Notes:
  - No Redis or Docker required.
  - Logs go to stderr; stdout is MCP JSON-RPC only.
  - Prefer e2ebuddy_run with wait=true for short targets; use wait=false + status for long runs.
`);
}

/** Block until the MCP server disconnects. */
export async function runMcp(): Promise<void> {
  await startMcpServer();
  // Keep process alive: StdioServerTransport owns stdin.
  await new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
}
