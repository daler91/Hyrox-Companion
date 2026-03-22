import { describe, it, expect, vi, beforeEach, afterEach, MockInstance } from "vitest";
import { apiRequest, getQueryFn } from "./queryClient";
import { QueryFunctionContext } from "@tanstack/react-query";

describe("queryClient", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
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
    fetchSpy.mockResolvedValue(mockResponse as unknown as Response);
    return mockResponse;
  }

  describe("apiRequest", () => {
    it.each([
      [
        "POST",
        { foo: "bar" },
        { "Content-Type": "application/json" },
        JSON.stringify({ foo: "bar" })
      ],
      [
        "GET",
        undefined,
        {},
        undefined
      ],
    ])("should make a request with correct method %s and body provided: %s", async (method, data, expectedHeaders, expectedBody) => {
      const mockResponse = mockFetchResponse({});

      const url = "/api/test";
      const res = await apiRequest(method, url, data);

      expect(fetchSpy).toHaveBeenCalledWith(url, {
        method,
        headers: expectedHeaders,
        body: expectedBody,
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

      expect(fetchSpy).toHaveBeenCalledWith("api/data", {
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
