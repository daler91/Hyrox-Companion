const fs = require('fs');
const file = 'client/src/hooks/useVoiceInput.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace voice/utils import
content = content.replace(/MAX_RETRIES,\n\s+RETRY_DELAY_MS,\n\s+RETRYABLE_ERRORS,\n\s+DEDUP_WINDOW_MS,/g, "RETRYABLE_ERRORS,");

// Add imports from constants
content = content.replace(/(import \{\n\s+RETRYABLE_ERRORS,\n\s+getVoiceErrorMessage,\n\s+getUserMediaErrorMessage,\n\} from "\.\/voice\/utils";)/g, "import {\n  RETRYABLE_ERRORS,\n  getVoiceErrorMessage,\n  getUserMediaErrorMessage,\n} from \"./voice/utils\";\nimport {\n  VOICE_MAX_RETRIES,\n  VOICE_RETRY_DELAY_MS,\n  VOICE_DEDUP_WINDOW_MS,\n} from \"./constants\";");

// Update usages
content = content.replace(/DEDUP_WINDOW_MS/g, 'VOICE_DEDUP_WINDOW_MS');
content = content.replace(/MAX_RETRIES/g, 'VOICE_MAX_RETRIES');
content = content.replace(/RETRY_DELAY_MS/g, 'VOICE_RETRY_DELAY_MS');

fs.writeFileSync(file, content);

// Also remove them from voice/utils.ts
const utilsFile = 'client/src/hooks/voice/utils.ts';
let utilsContent = fs.readFileSync(utilsFile, 'utf8');
utilsContent = utilsContent.replace(/export const MAX_RETRIES = 2;\n/, '');
utilsContent = utilsContent.replace(/export const RETRY_DELAY_MS = 500;\n/, '');
utilsContent = utilsContent.replace(/export const DEDUP_WINDOW_MS = 3000;\n/, '');

fs.writeFileSync(utilsFile, utilsContent);
