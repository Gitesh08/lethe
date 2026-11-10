// Builds the single-file CLI bundle dist/lethe.mjs (Req 18.1, 18.3, 18.7, NFR-4).
// Plain ESM JS; run with `node scripts/build.mjs`.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const defaultOutfile = resolve(root, "dist", "lethe.mjs");

const SHIM = [
  "#!/usr/bin/env node",
  'import { createRequire as __letheCreateRequire } from "node:module";',
  "const require = __letheCreateRequire(import.meta.url);",
].join("\n");

/**
 * Bundle src/cli.ts into one ESM file with LF line endings.
 * @param {{ outfile?: string, write?: boolean }} [opts]
 * @returns {Promise<{ text: string, bytes: number, outfile: string }>}
 */
export async function buildBundle(opts = {}) {
  const outfile = opts.outfile ?? defaultOutfile;
  const write = opts.write ?? true;
  const result = await build({
    absWorkingDir: root,
    entryPoints: [resolve(root, "src", "cli.ts")],
    outfile,
    write: false,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: false,
    legalComments: "none",
    minify: false,
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: SHIM },
    logLevel: "silent",
  });
  const file = result.outputFiles?.[0];
  if (file === undefined || result.outputFiles?.length !== 1) {
    throw new Error("esbuild produced an unexpected number of output files");
  }
  const text = file.text.replace(/\r\n?/g, "\n");
  const bytes = Buffer.byteLength(text, "utf8");
  if (write) {
    await mkdir(dirname(outfile), { recursive: true });
    await writeFile(outfile, text, "utf8");
  }
  return { text, bytes, outfile };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  buildBundle().then(
    (r) => {
      console.error(`built ${r.outfile} (${r.bytes} bytes)`);
    },
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
