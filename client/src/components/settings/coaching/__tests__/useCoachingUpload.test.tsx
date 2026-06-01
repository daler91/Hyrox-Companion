import { act,renderHook } from "@testing-library/react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { useToast } from "@/hooks/use-toast";
import { useCreateCoachingMaterial } from "@/hooks/useCoachingMaterials";

import { useCoachingUpload } from "../useCoachingUpload";

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/hooks/useCoachingMaterials", () => ({
  useCreateCoachingMaterial: vi.fn(),
}));

describe("useCoachingUpload", () => {
  const mockToast = vi.fn();
  const mockMutateAsync = vi.fn();
  const mockMutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: mockToast });
    (useCreateCoachingMaterial as any).mockReturnValue({
      mutateAsync: mockMutateAsync,
      mutate: mockMutate,
      isPending: false,
    });
  });

  it("initializes with expected defaults", () => {
    const { result } = renderHook(() => useCoachingUpload());
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.dialogType).toBe("principles");
    expect(result.current.title).toBe("");
    expect(result.current.content).toBe("");
  });

  describe("processSingleFile", () => {
    it("handles file too large error", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["a".repeat(11 * 1024 * 1024)], "large.txt");

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: [file] },
        } as any);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: "File too large",
        description: "Maximum file size is 10MB.",
        variant: "destructive",
      });
      expect(result.current.dialogOpen).toBe(false);
    });

    it("handles extraction failure gracefully", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      // Simulate an extraction error, e.g. a PDF with invalid magic bytes
      const file = new File(["invalid-magic-bytes"], "test.pdf", { type: "application/pdf" });

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: [file] },
        } as any);
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Failed to read file",
        variant: "destructive",
      });
      expect(result.current.dialogOpen).toBe(false);
    });

    it("handles successful file extraction", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["valid text content"], "test-file.txt");

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: [file] },
        } as any);
      });

      expect(result.current.dialogType).toBe("document");
      expect(result.current.title).toBe("test-file");
      expect(result.current.content).toBe("valid text content");
      expect(result.current.dialogOpen).toBe(true);
    });
  });

  describe("processBatchFiles", () => {
    it("handles a mix of success, too large, and read failures", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const goodFile = new File(["good text"], "good.txt");
      const largeFile = new File(["a".repeat(11 * 1024 * 1024)], "large.txt");
      const badPdf = new File(["bad"], "bad.pdf", { type: "application/pdf" });

      mockMutateAsync.mockResolvedValueOnce({});

      await act(async () => {
        // Need batch upload path so pass an array of >1 file
        await result.current.handleFileUpload({
          target: { files: [goodFile, largeFile, badPdf] },
        } as any);
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith({
        title: "good",
        content: "good text",
        type: "document",
      });

      expect(mockToast).toHaveBeenCalledWith({
        title: "Uploaded 1 document",
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: "Files too large",
        description: "Skipped (>10MB): large.txt",
        variant: "destructive",
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: "Upload failed",
        description: "Failed to read: bad.pdf",
        variant: "destructive",
      });
    });

    it("handles mutation failure during batch upload", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file1 = new File(["content 1"], "file1.txt");
      const file2 = new File(["content 2"], "file2.txt");

      mockMutateAsync.mockRejectedValueOnce(new Error("Mutation failed"));
      mockMutateAsync.mockResolvedValueOnce({});

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: [file1, file2] },
        } as any);
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(2);

      expect(mockToast).toHaveBeenCalledWith({
        title: "Upload failed",
        description: "Failed to read: file1.txt",
        variant: "destructive",
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: "Uploaded 1 document",
      });
    });
  });

  describe("handleSave", () => {
    it("does not mutate if title or content is empty", () => {
      const { result } = renderHook(() => useCoachingUpload());

      act(() => {
        result.current.handleSave();
      });

      expect(mockMutate).not.toHaveBeenCalled();

      act(() => {
        result.current.setTitle("Test Title");
        result.current.setContent("");
        result.current.handleSave();
      });

      expect(mockMutate).not.toHaveBeenCalled();

      act(() => {
        result.current.setTitle("");
        result.current.setContent("Test Content");
        result.current.handleSave();
      });

      expect(mockMutate).not.toHaveBeenCalled();
    });

    it("calls mutate with correct data and trims whitespace", () => {
      const { result } = renderHook(() => useCoachingUpload());

      // Need to use state setters to update values
      act(() => {
        result.current.setTitle("  Test Title  ");
      });
      act(() => {
        result.current.setContent("  Test Content  ");
      });

      act(() => {
        result.current.handleSave();
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      expect(mockMutate).toHaveBeenCalledWith(
        { title: "Test Title", content: "Test Content", type: "principles" },
        expect.any(Object)
      );
    });

    it("closes dialog on successful mutation", () => {
      const { result } = renderHook(() => useCoachingUpload());

      act(() => {
        result.current.setDialogOpen(true);
        result.current.setTitle("Title");
        result.current.setContent("Content");
      });

      act(() => {
        result.current.handleSave();
      });

      // Simulate successful mutation callback
      const onSuccessCallback = mockMutate.mock.calls[0][1].onSuccess;
      act(() => {
        onSuccessCallback();
      });

      expect(result.current.dialogOpen).toBe(false);
    });
  });

  describe("handleFileUpload", () => {
    it("does nothing if no files are provided", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: null },
        } as any);
      });

      expect(mockToast).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleFileUpload({
          target: { files: [] },
        } as any);
      });

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("resets file input value after processing", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["content"], "test.txt");

      const mockEvent = {
        target: {
          files: [file],
        }
      };

      Object.defineProperty(result.current.fileInputRef, "current", { value: { value: "some-path" }, writable: true });

      await act(async () => {
        await result.current.handleFileUpload(mockEvent as any);
      });

      expect(result.current.fileInputRef.current?.value).toBe("");
    });
  });

  describe("openPrinciplesDialog", () => {
    it("resets state and opens dialog", () => {
      const { result } = renderHook(() => useCoachingUpload());

      act(() => {
        result.current.openPrinciplesDialog();
      });

      expect(result.current.dialogType).toBe("principles");
      expect(result.current.title).toBe("");
      expect(result.current.content).toBe("");
      expect(result.current.dialogOpen).toBe(true);
    });
  });
});
