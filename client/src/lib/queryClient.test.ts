import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRequest, getQueryFn } from "./queryClient";

describe("queryClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("apiRequest", () => {
    it("should make a request with correct URL, method, headers, and body when data is provided", async () => {
      const mockResponse = { ok: true };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const url = "/api/test";
      const method = "POST";
      const data = { foo: "bar" };

      const res = await apiRequest(method, url, data);

      expect(global.fetch).toHaveBeenCalledWith(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
        signal: undefined,
      });
      expect(res).toBe(mockResponse);
    });

    it("should not include Content-Type or body when data is not provided", async () => {
      const mockResponse = { ok: true };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const url = "/api/test";
      const method = "GET";

      const res = await apiRequest(method, url);

      expect(global.fetch).toHaveBeenCalledWith(url, {
        method,
        headers: {},
        body: undefined,
        credentials: "include",
        signal: undefined,
      });
      expect(res).toBe(mockResponse);
    });

    it("should throw an error with response text when response is not ok", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: vi.fn().mockResolvedValue("Validation failed"),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(apiRequest("GET", "/api/test")).rejects.toThrow("400: Validation failed");
    });

    it("should throw an error with statusText when response is not ok and text is empty", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue(""),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      await expect(apiRequest("GET", "/api/test")).rejects.toThrow("404: Not Found");
    });
  });

  describe("getQueryFn", () => {
    it("should return a function that calls fetch with URL joined by '/' and returns parsed JSON", async () => {
      const mockJson = { message: "success" };
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue(mockJson),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const queryFn = getQueryFn({ on401: "throw" });
      const queryKey = ["api", "data"];

      const result = await queryFn({ queryKey, meta: {} });

      expect(global.fetch).toHaveBeenCalledWith("api/data", {
        credentials: "include",
        signal: undefined,
      });
      expect(result).toBe(mockJson);
    });

    it("should return null on 401 when on401 is 'returnNull'", async () => {
      const mockResponse = {
        ok: false,
        status: 401,
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const queryFn = getQueryFn({ on401: "returnNull" });
      const queryKey = ["api", "protected"];

      const result = await queryFn({ queryKey, meta: {} });

      expect(result).toBeNull();
    });

    it("should throw an error on 401 when on401 is 'throw'", async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue("Missing token"),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const queryFn = getQueryFn({ on401: "throw" });
      const queryKey = ["api", "protected"];

      await expect(queryFn({ queryKey, meta: {} })).rejects.toThrow("401: Missing token");
    });

    it("should throw an error for non-ok status codes other than 401, even with 'returnNull'", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: vi.fn().mockResolvedValue("Crash"),
      };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const queryFn = getQueryFn({ on401: "returnNull" });
      const queryKey = ["api", "error"];

      await expect(queryFn({ queryKey, meta: {} })).rejects.toThrow("500: Crash");
    });
  });
});
