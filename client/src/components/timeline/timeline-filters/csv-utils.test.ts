import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { CSV_TEMPLATE,downloadTemplate } from "./csv-utils";

describe("csv-utils", () => {
  describe("downloadTemplate", () => {
    let mockCreateObjectURL: ReturnType<typeof vi.fn>;
    let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
    let mockClick: ReturnType<typeof vi.fn>;
    let mockRemove: ReturnType<typeof vi.fn>;
    let mockCreateElement: ReturnType<typeof vi.spyOn>;
    let mockAppendChild: ReturnType<typeof vi.spyOn>;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;

    beforeEach(() => {
      // Mock URL methods
      originalCreateObjectURL = globalThis.URL.createObjectURL;
      originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

      mockCreateObjectURL = vi.fn().mockReturnValue("blob:mock-url");
      mockRevokeObjectURL = vi.fn();

      Object.defineProperty(globalThis.URL, "createObjectURL", {
        writable: true,
        value: mockCreateObjectURL,
      });
      Object.defineProperty(globalThis.URL, "revokeObjectURL", {
        writable: true,
        value: mockRevokeObjectURL,
      });

      // Mock DOM methods
      mockClick = vi.fn();
      mockRemove = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      mockCreateElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName === "a") {
          element.click = mockClick;
          element.remove = mockRemove;
        }
        return element;
      });

      mockAppendChild = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    });

    afterEach(() => {
      // Restore URL methods
      Object.defineProperty(globalThis.URL, "createObjectURL", {
        writable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(globalThis.URL, "revokeObjectURL", {
        writable: true,
        value: originalRevokeObjectURL,
      });

      vi.restoreAllMocks();
    });

    it("creates a CSV blob with the template and triggers a download", () => {
      downloadTemplate();

      // Verify URL.createObjectURL was called
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);

      // Check the argument to createObjectURL (the Blob)
      const blob = mockCreateObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("text/csv;charset=utf-8;");

      // Verify an anchor element was created
      expect(mockCreateElement).toHaveBeenCalledWith("a");

      const anchorElement = mockCreateElement.mock.results[0].value as HTMLAnchorElement;

      // Note: JSDOM might prepend localhost/ depending on href assignment
      expect(anchorElement.href).toContain("blob:mock-url");
      expect(anchorElement.download).toBe("training_template.csv");

      // Verify DOM manipulation
      expect(mockAppendChild).toHaveBeenCalledWith(anchorElement);
      expect(mockClick).toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalled();

      // Verify cleanup
      expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });
  });
});
