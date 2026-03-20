const fs = require('fs');
const file = 'server/services/coachService.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  '        .sort((a, b) => a.date.localeCompare(b.date))',
  '        // Fast string comparison for YYYY-MM-DD dates instead of localeCompare\n        .sort((a, b) => {\n          if (b.date < a.date) return 1;\n          if (b.date > a.date) return -1;\n          return 0;\n        })'
);

fs.writeFileSync(file, code);
