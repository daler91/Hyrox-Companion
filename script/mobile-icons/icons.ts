import { readFileSync } from "node:fs";
import path from "node:path";

import { type IconNode, ICONS } from "./generate";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const ICONS_KT = path.join(ROOT, "mobile/composeApp/src/commonMain/kotlin/com/fitai/coach/ui/icons/generated/LucideIcons.kt");
export const LICENSE_TXT = path.join(ROOT, "mobile/composeApp/src/commonMain/composeResources/files/licenses/LICENSE-lucide.txt");
const LUCIDE = path.join(ROOT, "node_modules/lucide-react");

export function lucideVersion(): string {
  return (JSON.parse(readFileSync(path.join(LUCIDE, "package.json"), "utf8")) as { version: string }).version;
}

export function lucideLicense(): string {
  return readFileSync(path.join(LUCIDE, "LICENSE"), "utf8");
}

/** Each icon's shape nodes, read from lucide-react's ESM build. */
export async function loadIcons(): Promise<Record<string, IconNode[]>> {
  const icons: Record<string, IconNode[]> = {};
  for (const [name, file] of Object.entries(ICONS)) {
    const module = (await import(path.join(LUCIDE, "dist/esm/icons", `${file}.mjs`))) as {
      __iconData: { node: IconNode[] };
    };
    icons[name] = module.__iconData.node.map(([tag, attrs]) => {
      const { key: _key, ...rest } = attrs;
      return [tag, rest] as IconNode;
    });
  }
  return icons;
}
