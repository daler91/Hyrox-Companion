import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, getQueryFn } from "./queryClient";
import { QueryFunctionContext } from "@tanstack/react-query";

describe("queryClient", () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchResponse(options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    text?: string;
    json?: unknown;
  }) {
    const mockResponse = {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      statusText: options.statusText ?? "OK",
      ...(options.text !== undefined && { text: vi.fn().mockResolvedValue(options.text) }),
      ...(options.json !== undefined && { json: vi.fn().mockResolvedValue(options.json) }),
    };
    fetchMock.mockResolvedValue(mockResponse as unknown as Response);
    return mockResponse;
  }

  describe("apiRequest", () => {
    it("should attach CSRF token header on mutating POST requests", async () => {
      const mockResponse = { ok: true, status: 200, statusText: "OK" };
      // First call: GET /api/v1/csrf-token — returns token JSON
      // Second call: the actual POST
      fetchMock.mockImplementation((url: string) => {
        if (typeof url === "string" && url === "/api/v1/csrf-token") {
          return Promise.resolve({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ csrfToken: "tok-123" }) } as unknown as Response);
        }
        return Promise.resolve(mockResponse as unknown as Response);
      });

      const res = await apiRequest("POST", "/api/test", { foo: "bar" });

      // csrf-token fetch
      expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/csrf-token", { credentials: "include" });
      // actual mutation with token header
      expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": "tok-123" },
        body: JSON.stringify({ foo: "bar" }),
        credentials: "include",
        signal: undefined,
      });
      expect(res).toBe(mockResponse);
    });

    it("should not fetch or attach a CSRF token on GET requests", async () => {
      const mockResponse = mockFetchResponse({});

      const res = await apiRequest("GET", "/api/test");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/test", {
        method: "GET",
        headers: {},
        body: undefined,
        credentials: "include",
        signal: undefined,
      });
      expect(res).toBe(mockResponse);
    });

    it.each([
      [400, "Bad Request", "Validation failed", "400: Validation failed"],
      [404, "Not Found", "", "404: Not Found"],
    ])("should throw an error %s when response is not ok", async (status, statusText, text, expectedError) => {
      mockFetchResponse({ ok: false, status, statusText, text });
      await expect(apiRequest("GET", "/api/test")).rejects.toThrow(expectedError);
    });
  });

  describe("getQueryFn", () => {
    it("should return a function that calls fetch with URL joined by '/' and returns parsed JSON", async () => {
      const mockJson = { message: "success" };
      mockFetchResponse({ json: mockJson });

      const queryFn = getQueryFn({ on401: "throw" });
      const queryKey = ["api", "data"];

      const result = await queryFn({ queryKey } as unknown as QueryFunctionContext<string[], unknown>);

      expect(fetchMock).toHaveBeenCalledWith("api/data", {
        credentials: "include",
        signal: undefined,
      });
      expect(result).toEqual(mockJson);
    });

    it.each([
      ["returnNull" as const, 401, "Unauthorized", "Missing token", null, false],
      ["throw" as const, 401, "Unauthorized", "Missing token", "401: Missing token", true],
      ["returnNull" as const, 500, "Internal Server Error", "Crash", "500: Crash", true],
    ])("should handle error status %s with on401=%s correctly", async (on401, status, statusText, text, expected, shouldThrow) => {
      mockFetchResponse({ ok: false, status, statusText, text });

      const queryFn = getQueryFn({ on401 });
      const queryKey = ["api", "test"];
      const queryArgs = { queryKey } as unknown as QueryFunctionContext<string[], unknown>;

      if (shouldThrow) {
        await expect(queryFn(queryArgs)).rejects.toThrow(expected as string);
      } else {
        expect(await queryFn(queryArgs)).toBe(expected);
      }
    });
  });
});
