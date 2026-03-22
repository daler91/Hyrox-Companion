const fs = require('fs');
const file = 'client/src/hooks/use-toast.ts';
let content = fs.readFileSync(file, 'utf8');

content = `import { TOAST_LIMIT, TOAST_REMOVE_DELAY } from "./constants"\n` + content;
content = content.replace('const TOAST_LIMIT = 1\n', '');
content = content.replace('const TOAST_REMOVE_DELAY = 1000000\n', '');

fs.writeFileSync(file, content);
