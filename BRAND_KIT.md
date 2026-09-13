# Brand Kit — moved to `docs/BrandKit/`

The canonical brand kit is **[`docs/BrandKit/BRAND.md`](docs/BrandKit/BRAND.md)**, which lives
alongside the assets it describes:

| File                                                | What it is                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`BRAND.md`](docs/BrandKit/BRAND.md)                | Colour tokens, typography scale, component specs, motion — the source of truth |
| `fitai.coach — Nexus Brand Kit.pdf`                 | The designed presentation of the same system                                   |
| `logo-primary.svg`, `logo-ink.svg`, `logo-mono.svg` | Wordmark lockups                                                               |
| `mark-currentcolor.svg`                             | The Nexus mark alone, inheriting `currentColor`                                |

For how the tokens are actually wired into the app, see `--font-*` and the colour variables in
`client/src/index.css` and the `theme.extend` block in `tailwind.config.ts`.
[`design_guidelines.md`](design_guidelines.md) covers the higher-level UI approach — layout
patterns, screen-by-screen composition — rather than the tokens themselves.

---

**Why this file is a pointer.** It used to hold a byte-for-byte second copy of `BRAND.md` — 351
duplicated lines differing only in the path named in their own subtitle. Two copies of a token
system means one can be updated and the other silently left behind, and neither was linked from
anywhere, so nothing would have surfaced the divergence. The copy was replaced with this pointer
rather than deleted so the path keeps resolving for anything that already links here.
