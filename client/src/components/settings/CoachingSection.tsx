import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Plus, Upload, Trash2, Loader2, FileText } from "lucide-react";
import {
  useCoachingMaterials,
  useCreateCoachingMaterial,
  useDeleteCoachingMaterial,
} from "@/hooks/useCoachingMaterials";
import { useToast } from "@/hooks/use-toast";

export function CoachingSection() {
  const { toast } = useToast();
  const { data: materials, isLoading } = useCoachingMaterials();
  const createMutation = useCreateCoachingMaterial();
  const deleteMutation = useDeleteCoachingMaterial();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"principles" | "document">("principles");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openPrinciplesDialog = () => {
    setDialogType("principles");
    setTitle("");
    setContent("");
    setDialogOpen(true);
  };

  const processSingleFile = async (file: File) => {
    if (file.size > 500000) {
      toast({ title: "File too large", description: "Maximum file size is 500KB.", variant: "destructive" });
      return;
    }
    try {
      const text = await file.text();
      setDialogType("document");
      setTitle(file.name.replace(/\.[^/.]+$/, ""));
      setContent(text.slice(0, 50000));
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
      if (file.size > 500000) {
        tooLarge.push(file.name);
        continue;
      }
      try {
        const text = await file.text();
        await createMutation.mutateAsync({
          title: file.name.replace(/\.[^/.]+$/, ""),
          content: text.slice(0, 50000),
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
        description: `Skipped (>500KB): ${tooLarge.join(", ")}`,
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

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Coaching Knowledge
          </CardTitle>
          <CardDescription>
            Add training principles or reference materials for the AI coach to use when making workout decisions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {materials && materials.length > 0 ? (
                <div className="space-y-2">
                  {materials.map((material) => (
                    <div
                      key={material.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{material.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {material.type === "principles" ? "Principles" : "Document"} &middot; {Math.round(material.content.length / 1000)}k chars
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(material.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No coaching materials added yet. Add training principles or upload reference documents to help the AI coach make better decisions.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={openPrinciplesDialog}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Principles
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  Upload Document
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.csv"
                  multiple
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogType === "principles" ? "Add Training Principles" : "Upload Document"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="material-title">Title</Label>
              <Input
                id="material-title"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 255))}
                placeholder="e.g., Periodization Guidelines"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-content">
                {dialogType === "principles" ? "Training Principles" : "Document Content"}
              </Label>
              <Textarea
                id="material-content"
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, 50000))}
                placeholder={
                  dialogType === "principles"
                    ? "Paste your training principles, programming rules, or key excerpts here..."
                    : "Document content will appear here after upload..."
                }
                className="min-h-[200px]"
                rows={10}
              />
              <p className="text-xs text-muted-foreground text-right">
                {content.length.toLocaleString()}/50,000
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!title.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
