import { Loader2, FileText, Trash2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCoachingMaterials, useDeleteCoachingMaterial } from "@/hooks/useCoachingMaterials";

interface CoachingMaterialListProps {
  openPrinciplesDialog: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export function CoachingMaterialList({
  openPrinciplesDialog,
  fileInputRef,
  handleFileUpload,
}: Readonly<CoachingMaterialListProps>) {
  const { data: materials, isLoading } = useCoachingMaterials();
  const deleteMutation = useDeleteCoachingMaterial();

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
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
          accept=".txt,.md,.csv,.pdf,.docx"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>
    </>
  );
}
