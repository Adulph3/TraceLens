import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "dist");

await rm(outdir, { force: true, recursive: true });
await mkdir(join(outdir, "popup"), { recursive: true });
await mkdir(join(outdir, "icons"), { recursive: true });

await build({
  bundle: true,
  entryPoints: {
    background: join(root, "src/background/index.ts"),
    content: join(root, "src/content/index.ts"),
    "popup/popup": join(root, "src/popup/index.ts"),
  },
  format: "iife",
  legalComments: "none",
  outdir,
  platform: "browser",
  target: "firefox153",
});

await Promise.all([
  cp(join(root, "src/manifest.json"), join(outdir, "manifest.json")),
  cp(join(root, "src/popup/popup.html"), join(outdir, "popup/popup.html")),
  cp(join(root, "src/popup/popup.css"), join(outdir, "popup/popup.css")),
  cp(join(root, "src/icons/icon.svg"), join(outdir, "icons/icon.svg")),
  cp(join(root, "LICENSE"), join(outdir, "LICENSE")),
  cp(join(root, "THIRD_PARTY_NOTICES.md"), join(outdir, "THIRD_PARTY_NOTICES.md")),
]);
