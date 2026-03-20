const fs = require('fs');

const file = 'server/routes/analytics.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('import { rateLimiter }')) {
  code = code.replace(
    /import \{ getUserId \} from "\.\.\/types";/,
    'import { getUserId } from "../types";\nimport { rateLimiter } from "../routeUtils";'
  );
}

code = code.replace(
  /router\.get\("\/api\/v1\/personal-records", isAuthenticated, async/,
  'router.get("/api/v1/personal-records", isAuthenticated, rateLimiter("analytics", 20), async'
);

code = code.replace(
  /router\.get\("\/api\/v1\/exercise-analytics", isAuthenticated, async/,
  'router.get("/api/v1/exercise-analytics", isAuthenticated, rateLimiter("analytics", 20), async'
);

fs.writeFileSync(file, code);
console.log('patched');
