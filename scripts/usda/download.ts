/**
 * Downloads the USDA FoodData Central bulk files used by build-index.ts.
 * Files that already exist are skipped, so repeated runs make no requests.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { USDA_DATASETS } from "./datasets";

const RAW_DIR = join(resolve(__dirname, "..", ".."), "data", "usda", "raw");

async function main() {
  mkdirSync(RAW_DIR, { recursive: true });
  for (const ds of USDA_DATASETS) {
    const target = join(RAW_DIR, ds.file);
    if (existsSync(target)) {
      console.log(`✓ ${ds.file} already present`);
      continue;
    }
    console.log(`↓ ${ds.label} from ${ds.url}`);
    const res = await fetch(ds.url);
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${ds.url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(target, buf);
    console.log(`  saved ${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
