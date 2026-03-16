const fs = require('fs');

const filePath = 'client/src/components/timeline/SuggestionsPanel.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// The helper function to add
const helperFn = `
function getBadgeVariant(priority: string) {
  if (priority === "high") return "destructive";
  if (priority === "medium") return "default";
  return "secondary";
}
`;

// Add the helper function before the component definition
content = content.replace(
  'export default function SuggestionsPanel({',
  helperFn + '\nexport default function SuggestionsPanel({'
);

// Replace the nested ternary in variant
const oldVariant = `variant={suggestion.priority === "high" ? "destructive" : suggestion.priority === "medium" ? "default" : "secondary"}`;
const newVariant = `variant={getBadgeVariant(suggestion.priority)}`;

content = content.replace(oldVariant, newVariant);

fs.writeFileSync(filePath, content);
