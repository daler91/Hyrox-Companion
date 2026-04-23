import { BookOpen } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { CoachingMaterialList } from "./coaching/CoachingMaterialList";
import { CoachingUploadDialog } from "./coaching/CoachingUploadDialog";
import { RagStatusCard } from "./coaching/RagStatusCard";
import { useCoachingUpload } from "./coaching/useCoachingUpload";

export function CoachingSection() {
  const {
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
    isSaving,
  } = useCoachingUpload();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Coaching Knowledge
          </CardTitle>
          <CardDescription>
            Add training principles or reference materials for the AI coach to use when making workout decisions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CoachingMaterialList
            openPrinciplesDialog={openPrinciplesDialog}
            fileInputRef={fileInputRef}
            handleFileUpload={handleFileUpload}
          />
        </CardContent>
      </Card>

      <RagStatusCard />

      <CoachingUploadDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        dialogType={dialogType}
        title={title}
        setTitle={setTitle}
        content={content}
        setContent={setContent}
        handleSave={handleSave}
        isSaving={isSaving}
      />
    </>
  );
}
