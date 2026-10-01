import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

import * as queryClient from '@/lib/queryClient';

import { useChatSession } from '../useChatSession';

// Setup mock QueryClient
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

// The real module, so the hook's error handling sees the real
// RateLimitError / AiBudgetExceededError classes.
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}));


vi.mock('@tanstack/react-query', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...mod,
    useQueryClient: vi.fn(() => ({
      invalidateQueries: queryClient.queryClient.invalidateQueries,
    })),
    useQuery: vi.fn(() => ({ data: [], isLoading: false })),
    useMutation: vi.fn(({ mutationFn, onSuccess }: { mutationFn?: (...args: unknown[]) => Promise<unknown>; onSuccess?: () => void }) => {
      const run = async (...args: unknown[]) => {
        if (mutationFn) {
          try {
            await mutationFn(...args);
          } catch {
            // intentionally empty
          }
        }
        if (onSuccess) onSuccess();
      };
      return { mutate: run, mutateAsync: run, isPending: false };
    }),
  };
});

/** Reject every apiRequest, render a streaming session, and send `message`. */
async function sendAfterApiFailure(message: string, error: Error) {
  vi.mocked(queryClient.apiRequest).mockRejectedValue(error);

  const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

  await act(async () => {
    await result.current.sendMessage(message);
  });

  return result;
}

/** The failure path ends with the placeholder swapped for the error reply. */
function expectAssistantErrorReply(result: Awaited<ReturnType<typeof sendAfterApiFailure>>) {
  expect(result.current.messages).toHaveLength(3);
  expect(result.current.messages[2].role).toBe('assistant');
  // No text arrived, so the reply is only its failure note.
  expect(result.current.messages[2].content).toBe('');
  expect(result.current.messages[2].failure?.message).toBe('Something went wrong on our side. Please try again.');
  expect(result.current.isLoading).toBe(false);
}

const encoder = new TextEncoder();

/** A ReadableStream of SSE `data:` events. */
function sseStream(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
}

/** Route the mocked apiRequest: `stream` answers /chat/stream, saves succeed. */
function mockStreamEndpoint(stream: () => Promise<Response>) {
  vi.mocked(queryClient.apiRequest).mockImplementation((_method, url) =>
    url === '/api/v1/chat/stream' ? stream() : Promise.resolve(new Response(JSON.stringify({}))),
  );
}

/** The bodies POSTed to /api/v1/chat/message so far. */
function savedTurns(): Array<{ role: string; content: string }> {
  return vi
    .mocked(queryClient.apiRequest)
    .mock.calls.filter(([, url]) => url === '/api/v1/chat/message')
    .map(([, , body]) => body as { role: string; content: string });
}

/** The body POSTed to /api/v1/chat/stream on the nth send (0-based). */
function streamRequest(n: number): { message: string; history: Array<{ role: string; content: string }> } {
  const calls = vi.mocked(queryClient.apiRequest).mock.calls.filter(([, url]) => url === '/api/v1/chat/stream');
  return calls[n][2] as { message: string; history: Array<{ role: string; content: string }> };
}

describe('useChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryClient.queryClient.invalidateQueries).mockResolvedValue(undefined);
    globalThis.fetch = vi.fn();
    // Default apiRequest mock to return a simple response to avoid 'json' of undefined errors
    vi.mocked(queryClient.apiRequest).mockImplementation(async () =>
      new Response(JSON.stringify({})),
    );

    // Reset crypto mock
    Object.defineProperty(globalThis.window, 'crypto', {
      value: { randomUUID: (() => { let i = 0; return () => `test-uuid-${++i}` })() },
      configurable: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with welcome message', () => {
    const { result } = renderHook(() => useChatSession(), { wrapper });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('welcome');
    expect(result.current.messages[0].role).toBe('assistant');
  });

  it('should handle successful non-streaming chat', async () => {
    const mockResponse = { response: 'Hello from assistant' };
    vi.mocked(queryClient.apiRequest).mockImplementation(async (_method, url) =>
      new Response(JSON.stringify(url === '/api/v1/chat' ? mockResponse : {})),
    );

    const { result } = renderHook(() => useChatSession({ useStreaming: false }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(3); // welcome, user, assistant
    });
    expect(result.current.messages[1].role).toBe('user');
    expect(result.current.messages[1].content).toBe('Hello');
    expect(result.current.messages[2].role).toBe('assistant');
    expect(result.current.messages[2].content).toBe('Hello from assistant');
  });

  it('should handle chat session error recovery (stream request failed)', async () => {
    // Simulate a stream request failure (e.g. 500 error)
    const result = await sendAfterApiFailure('Fail stream', new Error('500: Internal Server Error'));

    // It should push a user message, a placeholder assistant message, and then update the placeholder to an error message
    expect(result.current.messages[1].role).toBe('user');
    expect(result.current.messages[1].content).toBe('Fail stream');
    expectAssistantErrorReply(result);
  });

  it('should handle chat session error recovery (fetch throws network error)', async () => {
    const result = await sendAfterApiFailure('Fail network', new Error('Network Error'));

    expectAssistantErrorReply(result);
  });

  it('should correctly handle successful stream chunk reading', async () => {
    // Mock a successful stream response
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"text":"Streaming "}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"text":"response"}\n\n'));
        controller.close();
      }
    });

    vi.mocked(queryClient.apiRequest).mockImplementation(async (_method, url) =>
      url === '/api/v1/chat/stream'
        ? new Response(mockStream)
        : new Response(JSON.stringify({})),
    );

    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Stream this');
    });

    // The stream result should be accumulated
    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[2].role).toBe('assistant');
    expect(result.current.messages[2].content).toBe('Streaming response');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle clear history', async () => {
    // Simulate some messages
    const { result } = renderHook(() => useChatSession(), { wrapper });

    await act(async () => {
      result.current.clearHistory();
    });

    expect(queryClient.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/v1/chat/history"] });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('welcome');
  });
  it('saves the turns only once the server accepts the request, user first', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Easy run, 40 min.' }, { done: true }))));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('What should I do today?');
    });

    await waitFor(() => expect(savedTurns()).toHaveLength(2));
    expect(savedTurns()).toEqual([
      { role: 'user', content: 'What should I do today?' },
      { role: 'assistant', content: 'Easy run, 40 min.' },
    ]);
  });

  it('does not save the turn the server refused, and names the rate limit with a retry', async () => {
    mockStreamEndpoint(() => Promise.reject(new queryClient.RateLimitError('Too many requests', 8)));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Hello?');
    });

    const reply = result.current.messages[2];
    expect(reply.failure?.message).toBe(
      "You're sending messages too quickly. Please wait about 8 seconds and try again.",
    );
    expect(reply.failure?.retry).toEqual({
      content: 'Hello?',
      userMessageId: result.current.messages[1].id,
      userSaved: false,
    });
    expect(result.current.streamError).toBe(reply.failure?.message);
    expect(savedTurns()).toEqual([]);
  });

  it('names the daily AI limit and offers no retry', async () => {
    mockStreamEndpoint(() => Promise.reject(new queryClient.AiBudgetExceededError('limit', 205, 200)));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('One more question');
    });

    expect(result.current.messages[2].failure?.message).toMatch(/daily AI usage limit/i);
    expect(result.current.messages[2].failure?.retry).toBeUndefined();
  });

  it("shows the server's reason when it ends the stream, and offers no retry for an expired session", async () => {
    mockStreamEndpoint(() =>
      Promise.resolve(new Response(sseStream({ error: 'auth-expired', reason: 'Your session expired — please sign in again.' }))),
    );
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Still there?');
    });

    expect(result.current.messages[2].failure).toEqual({
      message: 'Your session expired — please sign in again.',
    });
  });

  it('keeps text that arrived before a mid-stream failure, and marks the accepted turn as saved', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Start with a' }, { error: 'Stream error' }))));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Warm-up ideas?');
    });

    const reply = result.current.messages[2];
    expect(reply.content).toBe('Start with a');
    expect(reply.failure?.message).toBe('Something went wrong on our side. Please try again.');
    expect(reply.failure?.retry?.userSaved).toBe(true);
    await waitFor(() => expect(savedTurns()).toEqual([{ role: 'user', content: 'Warm-up ideas?' }]));
  });

  it('retries a failed send in place: the failed exchange goes, the new one is saved once', async () => {
    mockStreamEndpoint(() => Promise.reject(new Error('500: {"error":"Internal Server Error"}')));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Taper advice?');
    });
    const failedId = result.current.messages[2].id;

    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Cut volume by a third.' }, { done: true }))));
    await act(() => {
      result.current.retryMessage(failedId);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ['assistant', result.current.messages[0].content],
      ['user', 'Taper advice?'],
      ['assistant', 'Cut volume by a third.'],
    ]);
    // The resend carries no trace of the failed attempt.
    expect(streamRequest(1).history).toEqual([]);
    await waitFor(() =>
      expect(savedTurns()).toEqual([
        { role: 'user', content: 'Taper advice?' },
        { role: 'assistant', content: 'Cut volume by a third.' },
      ]),
    );
  });

  it('does not save the athlete turn again when retrying one the server had accepted', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ error: 'Stream error' }))));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Hill session?');
    });
    const failedId = result.current.messages[2].id;
    await waitFor(() => expect(savedTurns()).toHaveLength(1));

    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: '6 x 60 s hills.' }, { done: true }))));
    await act(() => {
      result.current.retryMessage(failedId);
    });

    await waitFor(() => expect(savedTurns()).toHaveLength(2));
    expect(savedTurns()).toEqual([
      { role: 'user', content: 'Hill session?' },
      { role: 'assistant', content: '6 x 60 s hills.' },
    ]);
  });

  it('leaves a failed reply out of the history sent with the next message', async () => {
    mockStreamEndpoint(() => Promise.reject(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('First try');
    });
    expect(result.current.messages[2].failure?.message).toMatch(/connection dropped/i);

    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Here you go.' }, { done: true }))));
    await act(async () => {
      await result.current.sendMessage('Second try');
    });

    expect(streamRequest(1).history).toEqual([{ role: 'user', content: 'First try' }]);
  });
  it("puts the server's safety notice on the reply it arrived with", async () => {
    const notice = { level: 'urgent', message: 'Pause hard training and seek prompt medical care.' };
    mockStreamEndpoint(() =>
      Promise.resolve(new Response(sseStream({ ragInfo: { source: 'none', chunkCount: 0 } }, { safetyNotice: notice }, { text: 'Get checked first.' }, { done: true }))),
    );
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('I had chest pain on my run');
    });

    expect(result.current.messages[2].content).toBe('Get checked first.');
    expect(result.current.messages[2].safetyNotice).toEqual(notice);
  });

  it('ignores a malformed safety notice', async () => {
    mockStreamEndpoint(() =>
      Promise.resolve(new Response(sseStream({ safetyNotice: { level: 'panic', message: 'x' } }, { text: 'Hi.' }, { done: true }))),
    );
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.messages[2].safetyNotice).toBeUndefined();
  });

  it('carries the safety notice on the non-streaming path too', async () => {
    const notice = { level: 'caution', message: 'Heart-rate zones can be unreliable.' };
    vi.mocked(queryClient.apiRequest).mockImplementation((_method, url) =>
      Promise.resolve(
        new Response(JSON.stringify(url === '/api/v1/chat' ? { response: 'Use RPE.', safetyNotice: notice } : {})),
      ),
    );
    const { result } = renderHook(() => useChatSession({ useStreaming: false }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('On bisoprolol, which zones?');
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(3));
    expect(result.current.messages[2].safetyNotice).toEqual(notice);
  });
  it('sends the workout in view with the message', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Solid.' }, { done: true }))));
    const { result } = renderHook(
      () => useChatSession({ focusPlanDayId: 'day-1', focusWorkoutLogId: 'log-1' }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sendMessage('How did that go?');
    });

    expect(streamRequest(0)).toMatchObject({ focusPlanDayId: 'day-1', focusWorkoutLogId: 'log-1' });
  });

  it('sends the workout in view on the non-streaming path too', async () => {
    vi.mocked(queryClient.apiRequest).mockImplementation((_method, url) =>
      Promise.resolve(new Response(JSON.stringify(url === '/api/v1/chat' ? { response: 'Solid.' } : {}))),
    );
    const { result } = renderHook(
      () => useChatSession({ useStreaming: false, focusWorkoutLogId: 'log-1' }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sendMessage('How did that go?');
    });

    const body = vi.mocked(queryClient.apiRequest).mock.calls.find(([, url]) => url === '/api/v1/chat')?.[2];
    expect(body).toMatchObject({ focusWorkoutLogId: 'log-1' });
  });
});
