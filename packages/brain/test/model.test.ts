import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleModelClient, type ModelCallMetric } from '../src/index.js';

const request = {
  purpose: 'adapter-test',
  model: 'mimo-v2.5-pro',
  system: 'Return JSON.',
  messages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'Inspect this page.' },
        { type: 'image' as const, mediaType: 'image/jpeg' as const, data: 'aGVsbG8=' },
      ],
    },
  ],
  maxTokens: 256,
  attempt: 1,
};

describe('OpenAICompatibleModelClient', () => {
  it('sends multimodal Chat Completions requests and parses usage', async () => {
    const metrics: ModelCallMetric[] = [];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"done","reason":"ok"}' } }],
          usage: { prompt_tokens: 31, completion_tokens: 9 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new OpenAICompatibleModelClient({
      apiKey: 'test-secret',
      baseUrl: 'https://models.example/v1/',
      visionModel: 'mimo-v2.5',
      thinking: 'disabled',
      fetch: fetchMock,
      onMetric: (metric) => metrics.push(metric),
    });

    await expect(client.complete(request)).resolves.toEqual({
      text: '{"type":"done","reason":"ok"}',
      inputTokens: 31,
      outputTokens: 9,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://models.example/v1/chat/completions');
    expect(init?.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer test-secret' }),
    );
    expect(String(init?.body)).toContain('data:image/jpeg;base64,aGVsbG8=');
    expect(String(init?.body)).toContain('"model":"mimo-v2.5"');
    expect(String(init?.body)).toContain('"thinking":{"type":"disabled"}');
    expect(metrics).toEqual([
      expect.objectContaining({ success: true, model: 'mimo-v2.5', inputTokens: 31, outputTokens: 9 }),
    ]);
  });

  it('parses text-part responses and does not expose error response bodies', async () => {
    const textClient = new OpenAICompatibleModelClient({
      apiKey: 'test-secret',
      baseUrl: 'https://models.example/v1',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'hello' }] } }] }),
          { status: 200 },
        ),
      ),
    });
    await expect(textClient.complete(request)).resolves.toEqual({
      text: 'hello',
      inputTokens: 0,
      outputTokens: 0,
    });

    const errorClient = new OpenAICompatibleModelClient({
      apiKey: 'test-secret',
      baseUrl: 'https://models.example/v1',
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('sensitive upstream body', { status: 401 }),
      ),
    });
    await expect(errorClient.complete(request)).rejects.toThrow('HTTP 401');
    await expect(errorClient.complete(request)).rejects.not.toThrow('sensitive upstream body');
  });
});
