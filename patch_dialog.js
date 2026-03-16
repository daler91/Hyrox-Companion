const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'client/src/components/timeline/WorkoutDetailDialog.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  'import { Dialog, DialogContent } from "@/components/ui/dialog";',
  'import { Dialog, DialogContent } from "@/components/ui/dialog";\nimport { cn } from "@/lib/utils";'
);

content = content.replace(
  '<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">',
  '<DialogContent className={cn("max-h-[85vh] overflow-y-auto", isEditing ? "max-w-4xl" : "max-w-lg")}>'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Patch applied to WorkoutDetailDialog.tsx width");
