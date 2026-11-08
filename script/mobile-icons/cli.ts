/**
 * Regenerates mobile/composeApp's Lucide icons and their licence file.
 *
 *   pnpm mobile:icons
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateIconsKotlin } from "./generate";
import { ICONS_KT, LICENSE_TXT, loadIcons, lucideLicense, lucideVersion, ROOT } from "./icons";

const icons = await loadIcons();
mkdirSync(path.dirname(ICONS_KT), { recursive: true });
writeFileSync(ICONS_KT, generateIconsKotlin(icons, lucideVersion()), "utf8");
mkdirSync(path.dirname(LICENSE_TXT), { recursive: true });
writeFileSync(LICENSE_TXT, lucideLicense(), "utf8");
process.stdout.write(`Wrote ${Object.keys(icons).length} icons to ${path.relative(ROOT, ICONS_KT)}\n`);
