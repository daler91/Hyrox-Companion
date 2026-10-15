# Palette Journal

## 2026-10-15 - PlanToolsMenu was the sole aria-hidden outlier
**Learning:** This codebase has exceptionally thorough accessibility practices — systematic audits (coded as U5, U11, U20, U26, etc.) cover nearly every interactive element. The one gap found (10 missing `aria-hidden` on dropdown menu icons) was isolated to a single file while 50+ other components followed the pattern correctly. When searching for a11y improvements here, focus on consistency audits (grep for the pattern and find outliers) rather than looking for broad gaps.
**Action:** Use pattern-matching grep searches (`className="h-4 w-4 mr-2" />` without `aria-hidden`) to find future inconsistencies across the codebase.
