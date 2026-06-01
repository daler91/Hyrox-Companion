import { act, renderHook } from "@testing-library/react";
import { formatDistanceToNow } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGarminMutations } from "@/hooks/useGarminMutations";

import { useGarminConnectionController } from "../useGarminConnectionController";

// Mock the dependencies
vi.mock("@/hooks/useGarminMutations", () => ({
  useGarminMutations: vi.fn(),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

describe("useGarminConnectionController", () => {
  const mockConnectGarminMutation = { mutate: vi.fn() };
  const mockDisconnectGarminMutation = { mutate: vi.fn() };
  const mockSyncGarminMutation = { mutate: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useGarminMutations).mockReturnValue({
      connectGarminMutation: mockConnectGarminMutation as any,
      disconnectGarminMutation: mockDisconnectGarminMutation as any,
      syncGarminMutation: mockSyncGarminMutation as any,
    });
  });

  describe("Status and State", () => {
    it("should initialize with default state when garminStatus is undefined", () => {
      const { result } = renderHook(() => useGarminConnectionController(undefined));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.hasError).toBe(false);
      expect(result.current.statusText).toBe("Import activities from Garmin Connect");
    });

    it("should display correct status text when connected but not yet synced", () => {
      const mockGarminStatus = { connected: true, lastSyncedAt: null, lastError: null };
      const { result } = renderHook(() => useGarminConnectionController(mockGarminStatus as any));

      expect(result.current.isConnected).toBe(true);
      expect(result.current.hasError).toBe(false);
      expect(result.current.statusText).toBe("Not yet synced");
    });

    it("should display formatted last synced date when connected and synced", () => {
      const mockGarminStatus = { connected: true, lastSyncedAt: "2023-10-27T10:00:00Z", lastError: null };
      const { result } = renderHook(() => useGarminConnectionController(mockGarminStatus as any));

      expect(result.current.isConnected).toBe(true);
      expect(result.current.hasError).toBe(false);
      expect(result.current.statusText).toBe("Last synced 2 hours ago");
      expect(formatDistanceToNow).toHaveBeenCalledWith(new Date("2023-10-27T10:00:00Z"), { addSuffix: true });
    });

    it("should set hasError to true when connected and lastError is present", () => {
      const mockGarminStatus = { connected: true, lastSyncedAt: null, lastError: "Rate limit exceeded" };
      const { result } = renderHook(() => useGarminConnectionController(mockGarminStatus as any));

      expect(result.current.isConnected).toBe(true);
      expect(result.current.hasError).toBe(true);
    });
  });

  describe("Connection Logic (handleConnect)", () => {
    it("should not trigger mutation if email is empty", () => {
      const { result } = renderHook(() => useGarminConnectionController(undefined));

      act(() => {
        result.current.setPassword("password123");
      });
      act(() => {
        result.current.handleConnect();
      });

      expect(mockConnectGarminMutation.mutate).not.toHaveBeenCalled();
    });

    it("should not trigger mutation if password is empty", () => {
      const { result } = renderHook(() => useGarminConnectionController(undefined));

      act(() => {
        result.current.setEmail("test@example.com");
      });
      act(() => {
        result.current.handleConnect();
      });

      expect(mockConnectGarminMutation.mutate).not.toHaveBeenCalled();
    });

    it("should trigger mutation with correct arguments when inputs are valid", () => {
      const { result } = renderHook(() => useGarminConnectionController(undefined));

      act(() => {
        result.current.setEmail("test@example.com");
        result.current.setPassword("password123");
      });
      act(() => {
        result.current.handleConnect();
      });

      expect(mockConnectGarminMutation.mutate).toHaveBeenCalledWith(
        { email: "test@example.com", password: "password123" },
        expect.any(Object)
      );
    });

    it("should clear email and password on successful connection", () => {
      // Setup mutation to immediately call onSuccess callback
      mockConnectGarminMutation.mutate.mockImplementation((_: any, options: any) => {
        if (options?.onSuccess) {
          options.onSuccess();
        }
      });

      const { result } = renderHook(() => useGarminConnectionController(undefined));

      act(() => {
        result.current.setEmail("test@example.com");
        result.current.setPassword("password123");
      });
      act(() => {
        result.current.handleConnect();
      });

      expect(result.current.email).toBe("");
      expect(result.current.password).toBe("");
    });
  });
});
