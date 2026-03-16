const fs = require('fs');

const filePath = 'client/src/components/timeline/TimelineDateGroup.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// The helper function to add
const helperFn = `
function getDotColor(isTodayDate: boolean, isPast: boolean) {
  if (isTodayDate) return "bg-primary";
  if (isPast) return "bg-muted-foreground/30";
  return "bg-muted-foreground/50";
}
`;

// Add the helper function before the component definition
content = content.replace(
  'const TimelineDateGroupComponent = forwardRef<HTMLDivElement, TimelineDateGroupProps>(',
  helperFn + '\nconst TimelineDateGroupComponent = forwardRef<HTMLDivElement, TimelineDateGroupProps>('
);

// Replace the nested ternary in className
const oldClassName = `className={\`h-3 w-3 rounded-full \${
              isTodayDate
                ? "bg-primary"
                : isPast
                ? "bg-muted-foreground/30"
                : "bg-muted-foreground/50"
            }\`}`;

const newClassName = `className={\`h-3 w-3 rounded-full \${getDotColor(isTodayDate, isPast)}\`}`;

content = content.replace(oldClassName, newClassName);

fs.writeFileSync(filePath, content);
