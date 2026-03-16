const fs = require('fs');
const filepath = './client/src/components/timeline/WorkoutDetailDialog.tsx';
let content = fs.readFileSync(filepath, 'utf8');

// 1. Widen the container
content = content.replace(
    '<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">',
    '<DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">'
);

// We want to wrap the contents inside the `DialogContent` with a grid layout.
// So, the structure currently looks like:
// <WorkoutDetailHeader ... />
// {isEditing ? <WorkoutDetailEditForm ... /> : <WorkoutDetailView ... />}
// {canChangeStatus && !isEditing && <StatusChangeSection ... />}
// <WorkoutDetailFooter ... />

// It makes sense to group things into columns.
// Left Column: Metadata / Actions
// - <WorkoutDetailHeader /> (maybe keep it on top or left)
// - {canChangeStatus && ... StatusChangeSection}
// - <WorkoutDetailFooter /> (Wait, footer has Save button, we want that left)

// Right Column: Main Content
// - WorkoutDetailEditForm or WorkoutDetailView

// Wait, the Header is often full width. Let's keep Header full width.
// Or we can put Header on the left.
// Let's wrap the whole body inside a grid, similar to LogWorkout.
// Wait, WorkoutDetailHeader has title (day/week), status, and focus.

const headerStart = content.indexOf('<WorkoutDetailHeader');
const headerEnd = content.indexOf('/>', headerStart) + '/>'.length;
const headerStr = content.substring(headerStart, headerEnd);

const isEditingBlockStart = content.indexOf('{isEditing ? (');
const isEditingBlockEnd = content.indexOf(')}', content.indexOf('<WorkoutDetailView')) + ')}'.length;
const mainContentStr = content.substring(isEditingBlockStart, isEditingBlockEnd);

const statusStart = content.indexOf('{canChangeStatus && !isEditing && (');
const statusEnd = content.indexOf(')}', content.indexOf('onChangeStatus={onChangeStatus}')) + ')}'.length;
const statusStr = content.substring(statusStart, statusEnd);

const footerStart = content.indexOf('<WorkoutDetailFooter');
const footerEnd = content.indexOf('/>', content.indexOf('onCombine={onCombine ? () => onCombine(entry) : undefined}')) + '/>'.length;
const footerStr = content.substring(footerStart, footerEnd);

const layout = `      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left Column: Metadata & Actions */}
        <div className="md:col-span-5 lg:col-span-4 space-y-6 md:sticky md:top-6">
          ${headerStr.trim()}
          ${statusStr.trim()}
          <div className="pt-2 pb-6 md:pb-0">
            ${footerStr.trim()}
          </div>
        </div>

        {/* Right Column: Workout Content */}
        <div className="md:col-span-7 lg:col-span-8 space-y-6 bg-card border rounded-lg p-4 shadow-sm">
          ${mainContentStr.trim()}
        </div>
      </div>`;

const bodyToReplace = content.substring(headerStart, footerEnd);

content = content.replace(bodyToReplace, layout);

fs.writeFileSync(filepath, content);
console.log("Patched WorkoutDetailDialog.tsx successfully.");
