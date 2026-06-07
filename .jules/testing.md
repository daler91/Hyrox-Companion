When writing tests for simple pure string parsing functions (like categorizing age bands):
- Check for invalid inputs: `null`, `undefined`, empty string, whitespace string.
- Check for valid boundary inputs exactly matching expected types/sets.
- Check for parsing robustness (leading/trailing spaces, extraneous whitespace around separators like dashes).
- Check for correct rejection of close-but-invalid inputs (e.g., matching the regex but not in a predefined set of canonical valid items).
- Use `describe` blocks to logically group related function tests inside a file-level `describe` block.
