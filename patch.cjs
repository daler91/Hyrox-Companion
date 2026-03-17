const fs = require('fs');
const file = 'client/src/components/OnboardingWizard.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /<div\s+className="flex gap-1 my-2"\s+role="progressbar"\s+aria-valuenow=\{idx \+ 1\}\s+aria-valuemin=\{1\}\s+aria-valuemax=\{total\}\s+aria-label=\{\`Step \$\{idx \+ 1\} of \$\{total\}\`\}\s*>/,
  '<progress\n          value={idx + 1}\n          max={total}\n          className="sr-only"\n          aria-label={`Step ${idx + 1} of ${total}`}\n        />\n        <div className="flex gap-1 my-2" aria-hidden="true">'
);

fs.writeFileSync(file, content);
