import {
  AnthropicModelClient,
  OpenAICompatibleModelClient,
  type ModelCallMetric,
  type ModelClient,
} from 'brain';
import type { UrlGuard } from 'executor';

export type ConfiguredModels = {
  client: ModelClient;
  agentModel: string;
  reportModel: string;
};

export function createConfiguredModelClient(options?: {
  onMetric?: (metric: ModelCallMetric) => void;
}): ConfiguredModels {
  const onMetric =
    options?.onMetric ??
    ((metric: ModelCallMetric): void => {
      process.stderr.write(`[model] ${JSON.stringify(metric)}\n`);
    });

  const provider =
    process.env.AI_PROVIDER ??
    (process.env.AI_API_KEY === undefined ? 'anthropic' : 'openai-compatible');

  if (provider === 'openai-compatible') {
    const apiKey = requireEnvironment('AI_API_KEY');
    const baseUrl = requireEnvironment('AI_BASE_URL');
    return {
      client: new OpenAICompatibleModelClient({
        apiKey,
        baseUrl,
        visionModel: process.env.AI_VISION_MODEL,
        thinking: parseThinking(process.env.AI_THINKING),
        onMetric,
      }),
      agentModel: requireEnvironment('AI_AGENT_MODEL'),
      reportModel: process.env.AI_REPORT_MODEL?.trim() || requireEnvironment('AI_AGENT_MODEL'),
    };
  }

  if (provider === 'anthropic') {
    return {
      client: new AnthropicModelClient({
        apiKey: requireEnvironment('ANTHROPIC_API_KEY'),
        onMetric,
      }),
      agentModel: requireEnvironment('ANTHROPIC_AGENT_MODEL'),
      reportModel:
        process.env.ANTHROPIC_REPORT_MODEL?.trim() || requireEnvironment('ANTHROPIC_AGENT_MODEL'),
    };
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

export function parseThinking(value: string | undefined): 'enabled' | 'disabled' | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === 'enabled' || value === 'disabled') return value;
  throw new Error('AI_THINKING must be enabled or disabled.');
}

export function createCliUrlGuard(targetUrl: string): UrlGuard | undefined {
  if (process.env.E2EBUDDY_ALLOW_PRIVATE_TARGETS !== 'true') return undefined;
  const allowedOrigin = new URL(targetUrl).origin;
  return {
    assertAllowed: async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== allowedOrigin) {
        throw new Error('Development private-target mode only allows the exact target origin.');
      }
      return url;
    },
  };
}

export function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}
