import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatSession } from '../useChatSession';
import * as queryClient from '@/lib/queryClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Setup mock QueryClient
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
);

vi.mock('@/lib/queryClient', () => ({
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
    useMutation: vi.fn(({ mutationFn, onSuccess }: { mutationFn?: (...args: unknown[]) => Promise<unknown>; onSuccess?: () => void }) => ({
      mutate: async (...args: unknown[]) => {
        if (mutationFn) {
          try {
            await mutationFn(...args);
          } catch {
            // intentionally empty
          }
        }
        if (onSuccess) onSuccess();
      },
      isPending: false,
    })),
  };
});

describe('useChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queryClient.queryClient.invalidateQueries).mockResolvedValue(undefined);
    globalThis.fetch = vi.fn();
    // Default apiRequest mock to return a simple response to avoid 'json' of undefined errors
    vi.mocked(queryClient.apiRequest).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    } as Response);

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
    vi.mocked(queryClient.apiRequest).mockResolvedValue({
      json: () => Promise.resolve(mockResponse)
    } as Response);

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
    // Mock apiRequest to simulate a stream request failure (e.g. 500 error)
    vi.mocked(queryClient.apiRequest).mockRejectedValue(new Error('500: Internal Server Error'));

    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Fail stream');
    });

    // It should push a user message, a placeholder assistant message, and then update the placeholder to an error message
    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[1].role).toBe('user');
    expect(result.current.messages[1].content).toBe('Fail stream');

    expect(result.current.messages[2].role).toBe('assistant');
    expect(result.current.messages[2].content).toBe('Sorry, I encountered an error. Please try again.');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle chat session error recovery (fetch throws network error)', async () => {
    // Mock apiRequest to simulate a network error
    vi.mocked(queryClient.apiRequest).mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useChatSession({ useStreaming: true }), { wrapper });

    await act(async () => {
      await result.current.sendMessage('Fail network');
    });

    expect(result.current.messages).toHaveLength(3);
    expect(result.current.messages[2].role).toBe('assistant');
    expect(result.current.messages[2].content).toBe('Sorry, I encountered an error. Please try again.');
    expect(result.current.isLoading).toBe(false);
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

    vi.mocked(queryClient.apiRequest).mockResolvedValue({
      ok: true,
      body: mockStream,
    } as unknown as Response);

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
});
