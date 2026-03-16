const fs = require('fs');

const content = fs.readFileSync('server/gemini.test.ts', 'utf8');

// The file currently has a very messy block of imports at the top:
/*
import { exerciseSetSchema } from "@shared/schema";
import {
 describe, it, expect, vi } from "vitest";
import { exerciseSetSchema } from "@shared/schema";
import {

  isRetryableError,
  retryWithBackoff,
  workoutSuggestionSchema,
  parsedExerciseSchema,

} from "./gemini";
import { exerciseSetSchema } from "@shared/schema";
import {
 z } from "zod";
*/

const lines = content.split('\n');
const startIndex = lines.findIndex(line => line.includes('describe("isRetryableError", () => {'));

const cleanImports = `import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { exerciseSetSchema } from "@shared/schema";
import {
  isRetryableError,
  retryWithBackoff,
  workoutSuggestionSchema,
  parsedExerciseSchema,
} from "./gemini";

`;

const newContent = cleanImports + lines.slice(startIndex).join('\n');
fs.writeFileSync('server/gemini.test.ts', newContent);
