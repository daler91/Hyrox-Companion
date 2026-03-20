const fs = require('fs');
const file = 'client/src/components/settings/CoachingSection.tsx';
let code = fs.readFileSync(file, 'utf8');

const oldHandleFileUpload = `  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Single file: open dialog for review
    if (files.length === 1) {
      const file = files[0];
      if (file.size > 500000) {
        toast({ title: "File too large", description: "Maximum file size is 500KB.", variant: "destructive" });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      try {
        const text = await file.text();
        setDialogType("document");
        setTitle(file.name.replace(/\\.[^/.]+$/, ""));
        setContent(text.slice(0, 50000));
        setDialogOpen(true);
      } catch {
        toast({ title: "Failed to read file", variant: "destructive" });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Multiple files: batch upload directly
    const tooLarge: string[] = [];
    const failed: string[] = [];
    let uploaded = 0;

    for (const file of Array.from(files)) {
      if (file.size > 500000) {
        tooLarge.push(file.name);
        continue;
      }
      try {
        const text = await file.text();
        await createMutation.mutateAsync({
          title: file.name.replace(/\\.[^/.]+$/, ""),
          content: text.slice(0, 50000),
          type: "document",
        });
        uploaded++;
      } catch {
        failed.push(file.name);
      }
    }

    if (uploaded > 0) {
      toast({ title: \`Uploaded \${uploaded} document\${uploaded > 1 ? "s" : ""}\` });
    }
    if (tooLarge.length > 0) {
      toast({
        title: "Files too large",
        description: \`Skipped (>500KB): \${tooLarge.join(", ")}\`,
        variant: "destructive",
      });
    }
    if (failed.length > 0) {
      toast({
        title: "Upload failed",
        description: \`Failed to read: \${failed.join(", ")}\`,
        variant: "destructive",
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };`;

const newHandleFileUpload = `  const processSingleFile = async (file: File) => {
    if (file.size > 500000) {
      toast({ title: "File too large", description: "Maximum file size is 500KB.", variant: "destructive" });
      return;
    }
    try {
      const text = await file.text();
      setDialogType("document");
      setTitle(file.name.replace(/\\.[^/.]+$/, ""));
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
          title: file.name.replace(/\\.[^/.]+$/, ""),
          content: text.slice(0, 50000),
          type: "document",
        });
        uploaded++;
      } catch {
        failed.push(file.name);
      }
    }

    if (uploaded > 0) {
      toast({ title: \`Uploaded \${uploaded} document\${uploaded > 1 ? "s" : ""}\` });
    }
    if (tooLarge.length > 0) {
      toast({
        title: "Files too large",
        description: \`Skipped (>500KB): \${tooLarge.join(", ")}\`,
        variant: "destructive",
      });
    }
    if (failed.length > 0) {
      toast({
        title: "Upload failed",
        description: \`Failed to read: \${failed.join(", ")}\`,
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
  };`;

code = code.replace(oldHandleFileUpload, newHandleFileUpload);
fs.writeFileSync(file, code);
