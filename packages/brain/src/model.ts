import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';

export type ModelImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export type ModelContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: ModelImageMediaType; data: string };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: ModelContentBlock[];
}

export interface ModelRequest {
  purpose: string;
  model: string;
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  attempt: number;
}

export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCallMetric {
  purpose: string;
  model: string;
  attempt: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  success: boolean;
  error?: string;
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface AnthropicModelClientOptions {
  apiKey: string;
  onMetric?: (metric: ModelCallMetric) => void;
}

export interface OpenAICompatibleModelClientOptions {
  apiKey: string;
  baseUrl: string;
  onMetric?: (metric: ModelCallMetric) => void;
  fetch?: typeof globalThis.fetch;
  visionModel?: string;
  thinking?: 'enabled' | 'disabled';
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAITextPart {
  type?: string;
  text?: string;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | OpenAITextPart[] | null } }>;
  usage?: OpenAIUsage;
}

export class OpenAICompatibleModelClient implements ModelClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly onMetric?: (metric: ModelCallMetric) => void;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly visionModel?: string;
  private readonly thinking?: 'enabled' | 'disabled';

  constructor(options: OpenAICompatibleModelClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (baseUrl.length === 0) throw new Error('OpenAI-compatible base URL is required.');
    this.endpoint = `${baseUrl}/chat/completions`;
    this.apiKey = options.apiKey;
    this.onMetric = options.onMetric;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.visionModel = options.visionModel?.trim() || undefined;
    this.thinking = options.thinking;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    const selectedModel =
      this.visionModel !== undefined &&
      request.messages.some((message) => message.content.some((block) => block.type === 'image'))
        ? this.visionModel
        : request.model;
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: request.maxTokens,
          thinking: this.thinking === undefined ? undefined : { type: this.thinking },
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.map((message) => ({
              role: message.role,
              content: message.content.map((block) =>
                block.type === 'text'
                  ? { type: 'text', text: block.text }
                  : {
                      type: 'image_url',
                      image_url: { url: `data:${block.mediaType};base64,${block.data}` },
                    },
              ),
            })),
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`OpenAI-compatible model request failed with HTTP ${response.status}.`);
      }
      const payload: unknown = await response.json();
      const parsed = this.parseResponse(payload);
      this.onMetric?.({
        purpose: request.purpose,
        model: selectedModel,
        attempt: request.attempt,
        durationMs: Date.now() - startedAt,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        success: true,
      });
      return parsed;
    } catch (error) {
      this.onMetric?.({
        purpose: request.purpose,
        model: selectedModel,
        attempt: request.attempt,
        durationMs: Date.now() - startedAt,
        success: false,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      });
      throw error;
    }
  }

  private parseResponse(payload: unknown): ModelResponse {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('OpenAI-compatible model returned an invalid JSON response.');
    }
    const response = payload as OpenAIChatResponse;
    const content = response.choices?.[0]?.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((part) => part.type === undefined || part.type === 'text')
              .map((part) => part.text ?? '')
              .join('\n')
          : '';
    if (text.length === 0) {
      throw new Error('OpenAI-compatible model response did not contain text.');
    }
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  private readonly onMetric?: (metric: ModelCallMetric) => void;

  constructor(options: AnthropicModelClientOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });
    this.onMetric = options.onMetric;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages.map(this.toAnthropicMessage),
      });
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const result = {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
      this.onMetric?.({
        purpose: request.purpose,
        model: request.model,
        attempt: request.attempt,
        durationMs: Date.now() - startedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        success: true,
      });
      return result;
    } catch (error) {
      this.onMetric?.({
        purpose: request.purpose,
        model: request.model,
        attempt: request.attempt,
        durationMs: Date.now() - startedAt,
        success: false,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      });
      throw error;
    }
  }

  private readonly toAnthropicMessage = (message: ModelMessage): MessageParam => ({
    role: message.role,
    content: message.content.map((block): ContentBlockParam => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mediaType, data: block.data },
      };
    }),
  });
}
