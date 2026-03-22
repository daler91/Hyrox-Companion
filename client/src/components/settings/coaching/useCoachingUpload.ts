import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useCreateCoachingMaterial } from "@/hooks/useCoachingMaterials";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Strip null bytes and non-printable control characters that PostgreSQL text columns reject. */
function sanitizeText(text: string): string {
  return text.replaceAll(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return sanitizeText(pages.join("\n\n"));
}

async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return sanitizeText(result.value);
}

async function extractFileText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return extractPdfText(file);
  if (ext === "docx") return extractDocxText(file);
  return sanitizeText(await file.text());
}

export function useCoachingUpload() {
  const { toast } = useToast();
  const createMutation = useCreateCoachingMaterial();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"principles" | "document">("principles");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const openPrinciplesDialog = () => {
    setDialogType("principles");
    setTitle("");
    setContent("");
    setDialogOpen(true);
  };

  const processSingleFile = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
      return;
    }
    try {
      const text = await extractFileText(file);
      setDialogType("document");
      setTitle(file.name.replace(/\.[^/.]+$/, ""));
      setContent(text.slice(0, 1500000));
      setDialogOpen(true);
    } catch {
      toast({ title: "Failed to read file", variant: "destructive" });
    }
  };

  const processBatchFiles = async (files: File[]) => {
    const tooLarge: string[] = [];
    const failed: string[] = [];
    let uploaded = 0;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        tooLarge.push(file.name);
        continue;
      }
      try {
        const text = await extractFileText(file);
        await createMutation.mutateAsync({
          title: file.name.replace(/\.[^/.]+$/, ""),
          content: text.slice(0, 1500000),
          type: "document",
        });
        uploaded++;
      } catch {
        failed.push(file.name);
      }
    }

    if (uploaded > 0) {
      toast({ title: `Uploaded ${uploaded} document${uploaded > 1 ? "s" : ""}` });
    }
    if (tooLarge.length > 0) {
      toast({
        title: "Files too large",
        description: `Skipped (>10MB): ${tooLarge.join(", ")}`,
        variant: "destructive",
      });
    }
    if (failed.length > 0) {
      toast({
        title: "Upload failed",
        description: `Failed to read: ${failed.join(", ")}`,
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (files.length === 1) {
      await processSingleFile(files[0]);
    } else {
      await processBatchFiles(Array.from(files));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSave = () => {
    if (!title.trim() || !content.trim()) return;
    createMutation.mutate(
      { title: title.trim(), content: content.trim(), type: dialogType },
      { onSuccess: () => setDialogOpen(false) },
    );
  };

  return {
    dialogOpen,
    setDialogOpen,
    dialogType,
    title,
    setTitle,
    content,
    setContent,
    fileInputRef,
    openPrinciplesDialog,
    handleFileUpload,
    handleSave,
    isSaving: createMutation.isPending,
  };
}
