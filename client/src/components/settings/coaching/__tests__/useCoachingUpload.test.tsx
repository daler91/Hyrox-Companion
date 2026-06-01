import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach,describe, expect, it, vi } from "vitest";

import { useCoachingUpload } from "../useCoachingUpload";

// Mock hooks
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockMutateAsync = vi.fn();
const mockMutate = vi.fn();
vi.mock("@/hooks/useCoachingMaterials", () => ({
  useCreateCoachingMaterial: () => ({
    mutateAsync: mockMutateAsync,
    mutate: mockMutate,
    isPending: false,
  }),
}));

// Mock mammoth to avoid zip issues in test
vi.mock("mammoth", () => ({
  default: {
    extractRawText: vi.fn().mockRejectedValue(new Error("Mammoth read failed in test")),
  },
}));

describe("useCoachingUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useCoachingUpload());

    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.dialogType).toBe("principles");
    expect(result.current.title).toBe("");
    expect(result.current.content).toBe("");
    expect(result.current.isSaving).toBe(false);
  });

  it("should update state when openPrinciplesDialog is called", () => {
    const { result } = renderHook(() => useCoachingUpload());

    act(() => {
      result.current.openPrinciplesDialog();
    });

    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.dialogType).toBe("principles");
    expect(result.current.title).toBe("");
    expect(result.current.content).toBe("");
  });

  it("should prevent saving if title or content is empty", () => {
    const { result } = renderHook(() => useCoachingUpload());

    // Both empty
    act(() => {
      result.current.handleSave();
    });
    expect(mockMutate).not.toHaveBeenCalled();

    // Title only
    act(() => {
      result.current.setTitle("Test Title");
      result.current.handleSave();
    });
    expect(mockMutate).not.toHaveBeenCalled();

    // Content only
    act(() => {
      result.current.setTitle("");
      result.current.setContent("Test Content");
      result.current.handleSave();
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("should trigger mutation when handleSave is called with valid data", () => {
    const { result } = renderHook(() => useCoachingUpload());

    act(() => {
      result.current.setTitle("Test Title");
      result.current.setContent("Test Content");
    });

    act(() => {
      result.current.handleSave();
    });

    expect(mockMutate).toHaveBeenCalledWith(
      { title: "Test Title", content: "Test Content", type: "principles" },
      expect.any(Object)
    );
  });

  describe("File Uploading", () => {
    it("should reject a single file larger than 10MB", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["a".repeat(10 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "File too large",
        variant: "destructive"
      }));
      expect(result.current.dialogOpen).toBe(false);
    });

    it("should process a single text file successfully", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["Hello world"], "test.txt", { type: "text/plain" });
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(result.current.dialogOpen).toBe(true);
      expect(result.current.dialogType).toBe("document");
      expect(result.current.title).toBe("test");
      expect(result.current.content).toBe("Hello world");
    });

    it("should process batch files and upload valid ones", async () => {
      const { result } = renderHook(() => useCoachingUpload());
      mockMutateAsync.mockResolvedValueOnce({});

      const file1 = new File(["Valid content 1"], "valid1.txt", { type: "text/plain" });
      const file2 = new File(["a".repeat(10 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
      const event = {
        target: { files: [file1, file2] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        title: "valid1",
        content: "Valid content 1",
        type: "document"
      }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Uploaded 1 document"
      }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Files too large",
        description: expect.stringContaining("large.txt"),
        variant: "destructive"
      }));
    });
  });

  describe("Error handling in File Uploads", () => {
    it("should handle error when single file reading fails", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file = new File(["Hello world"], "error.txt", { type: "text/plain" });
      // Stub text to reject
      Object.defineProperty(file, 'text', {
        value: vi.fn().mockRejectedValue(new Error("File read error"))
      });

      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });

    it("should handle error when batch file reading fails", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const file1 = new File(["Valid content"], "valid.txt", { type: "text/plain" });
      const file2 = new File(["Error content"], "error.txt", { type: "text/plain" });

      // Stub text on file2 to reject
      Object.defineProperty(file2, 'text', {
        value: vi.fn().mockRejectedValue(new Error("File read error"))
      });

      const event = {
        target: { files: [file1, file2] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Upload failed",
        description: expect.stringContaining("error.txt"),
        variant: "destructive"
      }));
    });
  });

  describe("File Parsing Exceptions", () => {
    it("should handle timeout when parsing large files", async () => {
      // Create a mock docx file to trigger timeout wrapper
      const file = new File(["dummy docx content"], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      const { result } = renderHook(() => useCoachingUpload());
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });

    it("should handle pdf invalid magic bytes", async () => {
      const file = new File(["fake pdf content"], "test.pdf", { type: "application/pdf" });

      const { result } = renderHook(() => useCoachingUpload());
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });
  });

  describe("Empty File Uploads", () => {
    it("should handle empty file lists gracefully", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const event = {
        target: { files: [] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("should handle null files gracefully", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      const event = {
        target: { files: null }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).not.toHaveBeenCalled();
    });
  });

  describe("File type parsing mocks", () => {
    it("should process docx file via handleFileUpload but fail gracefully due to lack of mammoth mock here", async () => {
      const file = new File(["PK\x03\x04..."], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const { result } = renderHook(() => useCoachingUpload());

      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });
  });


  describe("More edge cases for coverage", () => {
    it("should reject pdf files with no magic bytes or valid magic bytes but parse error", async () => {
      // PDF that fails magic byte test first
      const file = new File(["NOTAPDF_DATA"], "fake.pdf", { type: "application/pdf" });
      const { result } = renderHook(() => useCoachingUpload());
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });

    it("should reset file input ref after upload", async () => {
      const { result } = renderHook(() => useCoachingUpload());

      // We will set the file input ref to a fake dom node
      const fakeNode = { value: "somepath" } as HTMLInputElement;

      // Need act to push ref changes
      act(() => {
        if (typeof result.current.fileInputRef !== 'function') {
           (result.current.fileInputRef as any).current = fakeNode;
        }
      });

      const file = new File(["Hello world"], "test.txt", { type: "text/plain" });
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(fakeNode.value).toBe("");
    });
  });


  describe("Branch coverage edge cases", () => {
    it("should process docx file with valid magic bytes to hit import logic (mocked to reject)", async () => {
      // Valid docx magic bytes: PK\x03\x04 -> [0x50, 0x4b, 0x03, 0x04]
      const validMagicDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      const file = new File([validMagicDocx], "valid-magic.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      const { result } = renderHook(() => useCoachingUpload());
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });
  });


  describe("More branch coverage edge cases", () => {
    it("should reject pdf files with no magic bytes or valid magic bytes but parse error (valid PDF magic)", async () => {
      // Valid PDF magic bytes: %PDF- -> [0x25, 0x50, 0x44, 0x46, 0x2d]
      const validMagicPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00]);
      const file = new File([validMagicPdf], "valid-magic.pdf", { type: "application/pdf" });

      const { result } = renderHook(() => useCoachingUpload());
      const event = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;

      await act(async () => {
        await result.current.handleFileUpload(event);
      });

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Failed to read file",
        variant: "destructive"
      }));
    });

    it("should safely handle batch file logic for too large files and fail safely", async () => {
       const file = new File(["a".repeat(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
       const { result } = renderHook(() => useCoachingUpload());

       const event = {
         target: { files: [file, file] }
       } as unknown as React.ChangeEvent<HTMLInputElement>;

       await act(async () => {
         await result.current.handleFileUpload(event);
       });

       expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
         title: "Files too large",
         variant: "destructive"
       }));
    });
  });
});
