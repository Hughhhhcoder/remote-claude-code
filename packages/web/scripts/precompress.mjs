// Precompress text-shaped assets in dist/ to .br and .gz siblings.
// Run after `vite build`; the host prefers precomputed siblings over
// runtime compression. Only emits siblings when the compressed form is
// at least ~5% smaller than the source — otherwise the double round-trip
// (disk read + header overhead) isn't worth it.
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "dist");

const EXT_OK = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".map", ".webmanifest", ".txt", ".ico"]);
const MIN_RATIO = 0.95; // keep compressed only if <95% of original size

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function fmt(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + "MB";
  if (n > 1024) return (n / 1024).toFixed(1) + "KB";
  return n + "B";
}

async function main() {
  try {
    await stat(DIST);
  } catch {
    console.error("[precompress] dist/ missing — run `vite build` first");
    process.exit(1);
  }
  const files = (await walk(DIST)).filter(
    (f) => EXT_OK.has(extname(f).toLowerCase()) && !f.endsWith(".br") && !f.endsWith(".gz"),
  );
  let totalRaw = 0;
  let totalBr = 0;
  let totalGz = 0;
  let wroteBr = 0;
  let wroteGz = 0;
  for (const f of files) {
    const src = await readFile(f);
    if (src.length < 1024) continue; // not worth it for tiny files
    totalRaw += src.length;
    const br = brotliCompressSync(src, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    const gz = gzipSync(src, { level: 9 });
    if (br.length / src.length < MIN_RATIO) {
      await writeFile(f + ".br", br);
      totalBr += br.length;
      wroteBr++;
    }
    if (gz.length / src.length < MIN_RATIO) {
      await writeFile(f + ".gz", gz);
      totalGz += gz.length;
      wroteGz++;
    }
  }
  console.log(
    `[precompress] ${wroteBr} .br + ${wroteGz} .gz from ${files.length} files — raw=${fmt(totalRaw)} br=${fmt(totalBr)} gz=${fmt(totalGz)}`,
  );
}

main().catch((e) => {
  console.error("[precompress]", e);
  process.exit(1);
});
