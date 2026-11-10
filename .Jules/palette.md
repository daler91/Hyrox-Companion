# Palette's Journal

## 2026-11-10 - Inline edit forms should match create-form affordances
**Learning:** The AddAthleteFactForm (create) included a CharacterCount + aria-describedby for the 140-char limit, but the AthleteFactEditor (inline edit) did not. Users editing an existing fact had no visual feedback about how close they were to the character limit — the native maxLength silently prevented typing, which is confusing. Always check that edit forms carry the same UX affordances as their create counterparts.
**Action:** When adding CharacterCount to a create form, grep for sibling edit forms that share the same maxLength and add it there too.
