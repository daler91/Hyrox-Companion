const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server/routes/auth.ts');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('import { AuthenticatedRequest }')) {
  content = content.replace(
    'import { getUserId } from "../types";',
    'import { getUserId, AuthenticatedRequest } from "../types";'
  );
  fs.writeFileSync(filePath, content, 'utf8');
}
console.log("Auth syntax patched");
