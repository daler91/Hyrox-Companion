import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  const setup = () => {
    const utils = renderHook(() => useCoachingUpload());
    const handleFiles = async (files: File[] | null) => {
      const event = {
        target: { files },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      await act(async () => {
        await utils.result.current.handleFileUpload(event);
      });
    };
    return { ...utils, handleFiles };
  };

  const createMockEvent = (files: File[] | null) => ({
    target: { files },
  }) as unknown as React.ChangeEvent<HTMLInputElement>;

  it("should initialize with default state and open dialog", () => {
    const { result } = setup();

    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.dialogType).toBe("principles");
    expect(result.current.title).toBe("");
    expect(result.current.content).toBe("");
    expect(result.current.isSaving).toBe(false);

    act(() => {
      result.current.openPrinciplesDialog();
    });

    expect(result.current.dialogOpen).toBe(true);
  });

  it.each([
    ["", ""],
    ["Test Title", ""],
    ["", "Test Content"],
  ])("should prevent saving if title ('%s') or content ('%s') is empty", (title, content) => {
    const { result } = setup();

    act(() => {
      result.current.setTitle(title);
      result.current.setContent(content);
      result.current.handleSave();
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("should trigger mutation when handleSave is called with valid data", () => {
    const { result } = setup();

    act(() => {
      result.current.setTitle("Test Title");
      result.current.setContent("Test Content");
    });

    act(() => {
      result.current.handleSave();
    });

    expect(mockMutate).toHaveBeenCalledWith(
      { title: "Test Title", content: "Test Content", type: "principles" },
      expect.any(Object),
    );
  });

  describe("File Uploading & Parsing", () => {
    const largeFile = new File(["a".repeat(10 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" });
    const textFile = new File(["Hello world"], "test.txt", { type: "text/plain" });
    const docxFile = new File(["PK\x03\x04..."], "test.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const pdfValidMagic = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00])], "valid.pdf", { type: "application/pdf" });
    const pdfInvalidMagic = new File(["NOTAPDF"], "fake.pdf", { type: "application/pdf" });
    const errorFile = new File(["Error"], "error.txt", { type: "text/plain" });
    Object.defineProperty(errorFile, 'text', { value: vi.fn().mockRejectedValue(new Error("File read error")) });

    it("should process a single text file successfully", async () => {
      const { result, handleFiles } = setup();
      await handleFiles([textFile]);

      expect(result.current.dialogOpen).toBe(true);
      expect(result.current.dialogType).toBe("document");
      expect(result.current.title).toBe("test");
      expect(result.current.content).toBe("Hello world");
    });

    it("should process batch files and upload valid ones", async () => {
      const { handleFiles } = setup();
      mockMutateAsync.mockResolvedValueOnce({});

      await handleFiles([textFile, largeFile]);

      expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "test", type: "document" }));
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Uploaded 1 document" }));
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Files too large" }));
    });

    it.each([
      [[largeFile], { title: "File too large" }],
      [[errorFile], { title: "Failed to read file" }],
      [[docxFile], { title: "Failed to read file" }],
      [[pdfInvalidMagic], { title: "Failed to read file" }],
      [[pdfValidMagic], { title: "Failed to read file" }],
    ])("single file failures: should toast error for %#", async (files, expectedToast) => {
      const { handleFiles } = setup();
      await handleFiles(files);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining(expectedToast));
    });

    it("batch failures: should toast error for read failures", async () => {
      const { handleFiles } = setup();
      await handleFiles([textFile, errorFile]);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Upload failed" }));
    });

    it("batch failures: should toast error for multiple large files", async () => {
      const { handleFiles } = setup();
      await handleFiles([largeFile, largeFile]);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Files too large" }));
    });

    it("should handle empty or null files gracefully", async () => {
      const { handleFiles } = setup();
      await handleFiles([]);
      await handleFiles(null);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("should reset file input ref after upload", async () => {
      const { result, handleFiles } = setup();
      const fakeNode = { value: "somepath" } as HTMLInputElement;

      act(() => {
        if (typeof result.current.fileInputRef !== 'function') {
           (result.current.fileInputRef as any).current = fakeNode;
        }
      });

      await handleFiles([textFile]);
      expect(fakeNode.value).toBe("");
    });
  });

  describe("Coverage edge cases", () => {
    const invalidDocxMagic = new File(["NOTADOCX"], "fake.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const validPdfMagicParseError = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00])], "valid.pdf", { type: "application/pdf" });

    it("should handle invalid docx magic bytes", async () => {
      const { handleFiles } = setup();
      await handleFiles([invalidDocxMagic]);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to read file" }));
    });

    it("should process docx file with valid magic bytes to hit import logic (mocked to reject)", async () => {
      // Valid docx magic bytes: PK\x03\x04 -> [0x50, 0x4b, 0x03, 0x04]
      const validMagicDocx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], "valid-magic.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const { handleFiles } = setup();
      await handleFiles([validMagicDocx]);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to read file" }));
    });
  });

});
