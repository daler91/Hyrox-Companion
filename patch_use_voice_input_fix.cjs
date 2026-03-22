const fs = require('fs');
const file = 'client/src/hooks/useVoiceInput.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/VOICE_VOICE_MAX_RETRIES/g, 'VOICE_MAX_RETRIES');
content = content.replace(/VOICE_VOICE_RETRY_DELAY_MS/g, 'VOICE_RETRY_DELAY_MS');
content = content.replace(/VOICE_VOICE_DEDUP_WINDOW_MS/g, 'VOICE_DEDUP_WINDOW_MS');
content = content.replace(/import \{\n  RETRYABLE_ERRORS,\n  getVoiceErrorMessage,\n  getUserMediaErrorMessage,\n\} from "\.\/voice\/utils";/, "import { RETRYABLE_ERRORS, getVoiceErrorMessage, getUserMediaErrorMessage } from \"./voice/utils\";");

fs.writeFileSync(file, content);
