import type { z } from 'zod';

import type { ModelClient, ModelContentBlock, ModelMessage } from './model.js';

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly causeText: string,
  ) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export interface StructuredRequest<T> {
  client: ModelClient;
  model: string;
  purpose: string;
  system: string;
  content: ModelContentBlock[];
  schema: z.ZodType<T>;
  maxTokens: number;
}

export async function requestStructured<T>(request: StructuredRequest<T>): Promise<T> {
  const messages: ModelMessage[] = [{ role: 'user', content: request.content }];
  let lastText = '';
  let lastError = 'No response was returned.';

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await request.client.complete({
      purpose: request.purpose,
      model: request.model,
      system: request.system,
      messages,
      maxTokens: request.maxTokens,
      attempt,
    });
    lastText = response.text.trim();

    try {
      const value: unknown = JSON.parse(normalizeJsonText(lastText));
      return request.schema.parse(value);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        messages.push(
          { role: 'assistant', content: [{ type: 'text', text: lastText }] },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `The previous response was invalid JSON or failed schema validation. Error:\n${lastError.slice(
                  0,
                  4_000,
                )}\nReturn one corrected JSON value only.`,
              },
            ],
          },
        );
      }
    }
  }

  throw new StructuredOutputError(
    `Model output failed schema validation after one retry: ${lastError}`,
    lastText,
  );
}

function normalizeJsonText(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match?.[1] ?? text;
}
