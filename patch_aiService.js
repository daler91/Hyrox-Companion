const fs = require('fs');
const file = 'server/services/aiService.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  '  recent.sort((a, b) => b.date.localeCompare(a.date));',
  '  recent.sort((a, b) => {\n    if (b.date < a.date) return -1;\n    if (b.date > a.date) return 1;\n    return 0;\n  });'
);

fs.writeFileSync(file, code);
