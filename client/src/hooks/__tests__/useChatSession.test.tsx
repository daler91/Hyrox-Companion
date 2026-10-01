import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
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

interface StreamBody {
  message: string;
  history?: unknown;
  userMessageId: string;
  assistantMessageId: string;
  replaceAssistantId?: string;
}

/** The body POSTed to /api/v1/chat/stream on the nth send (0-based). */
function streamRequest(n: number): StreamBody {
  const calls = vi.mocked(queryClient.apiRequest).mock.calls.filter(([, url]) => url === '/api/v1/chat/stream');
  return calls[n][2] as StreamBody;
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

  it("loads a workout's own thread in the workout chat, and the general one elsewhere", () => {
    vi.mocked(useQuery).mockClear();
    renderHook(() => useChatSession({ focusPlanDayId: 'day-1', focusWorkoutLogId: 'log-1' }), { wrapper });
    renderHook(() => useChatSession(), { wrapper });

    const keys = vi.mocked(useQuery).mock.calls.map(([options]) => options.queryKey);
    expect(keys).toContainEqual(['/api/v1/chat/history', { planDayId: 'day-1', workoutLogId: 'log-1' }]);
    expect(keys).toContainEqual(['/api/v1/chat/history']);
  });

  it('swaps in a welcome that arrives after mount', () => {
    const { result, rerender } = renderHook(
      ({ welcome }: { welcome?: string }) => useChatSession({ welcomeMessage: welcome }),
      { wrapper, initialProps: {} },
    );
    expect(result.current.messages[0].id).toBe('welcome');

    rerender({ welcome: 'Hi Sam! Today: Intervals.' });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ id: 'welcome', content: 'Hi Sam! Today: Intervals.' });
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

  it('lets the athlete rate a reply once it has arrived in full, but not one that failed', async () => {
    mockStreamEndpoint(async () => new Response(sseStream({ text: 'Run easy.' }, { done: true })));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Today?');
    });
    expect(result.current.messages[2]).toMatchObject({ content: 'Run easy.', rateable: true });
    expect(result.current.messages[1].rateable).toBeUndefined();

    const failed = await sendAfterApiFailure('Again?', new Error('500: Internal Server Error'));
    expect(failed.current.messages[2].rateable).toBeUndefined();
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
  it('hands both turns to the server under their ids, and sends no history', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Easy run, 40 min.' }, { done: true }))));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('What should I do today?');
    });

    const body = streamRequest(0);
    expect(body).toMatchObject({
      message: 'What should I do today?',
      userMessageId: result.current.messages[1].id,
      assistantMessageId: result.current.messages[2].id,
    });
    expect(body.history).toBeUndefined();
    expect(body.replaceAssistantId).toBeUndefined();
    // The server saved them; the client saves nothing itself.
    expect(savedTurns()).toEqual([]);
    expect(queryClient.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/v1/chat/history'] });
  });

  it('names the rate limit, and offers a retry', async () => {
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
    });
    expect(result.current.streamError).toBe(reply.failure?.message);
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

  it('keeps text that arrived before a mid-stream failure', async () => {
    mockStreamEndpoint(() => Promise.resolve(new Response(sseStream({ text: 'Start with a' }, { error: 'Stream error' }))));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Warm-up ideas?');
    });

    const reply = result.current.messages[2];
    expect(reply.content).toBe('Start with a');
    expect(reply.failure?.message).toBe('Something went wrong on our side. Please try again.');
    expect(reply.failure?.retry?.content).toBe('Warm-up ideas?');
  });

  it('retries a failed send in place, under the same message id, replacing the failed reply', async () => {
    mockStreamEndpoint(() => Promise.reject(new Error('500: {"error":"Internal Server Error"}')));
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Taper advice?');
    });
    const firstAttempt = streamRequest(0);
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
    // Saved once by the server however many attempts it takes, and the
    // failed reply is replaced.
    const retry = streamRequest(1);
    expect(retry.userMessageId).toBe(firstAttempt.userMessageId);
    expect(retry.replaceAssistantId).toBe(failedId);
    expect(retry.assistantMessageId).not.toBe(failedId);
    expect(result.current.messages[1].id).toBe(firstAttempt.userMessageId);
  });

  it('puts a drafted proposal on the reply it arrived with', async () => {
    const proposal = {
      id: 'proposal-1',
      planId: 'plan-1',
      status: 'pending',
      summaryMessage: 'Moved your long run to Saturday.',
      changes: [],
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    mockStreamEndpoint(() =>
      Promise.resolve(new Response(sseStream({ planProposalPending: true }, { text: 'Moved your long run to Saturday.' }, { planProposal: proposal }, { done: true }))),
    );
    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Move my long run to Saturday');
    });

    expect(result.current.messages[2]).toMatchObject({ kind: 'proposal', proposal: { id: 'proposal-1' } });
    expect(queryClient.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/v1/plan-proposals'] });
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
