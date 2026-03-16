const fs = require('fs');
let content = fs.readFileSync('server/routes/auth.ts', 'utf8');
content = content.replace(
  'import { getUserId } from "../types";',
  'import { getUserId, AuthenticatedRequest } from "../types";'
);
fs.writeFileSync('server/routes/auth.ts', content);
