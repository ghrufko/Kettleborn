// Scans exported app bundles for privileged Supabase credentials.
// Usage: npm run scan:bundles -- <export-dir> [<export-dir> ...]
// Prints only file names, offsets and the KIND of finding — never a value.
// Exits 1 if anything is found or a directory is missing.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const { scanContent } = await import(new URL('../src/security/bundleSecretScan.ts', import.meta.url).href);
const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: scan-bundle-secrets <export-dir> [...]');
  process.exit(2);
}
const SCANNED = /\.(js|hbc|json|html|map)$/;
let files = 0;
const findings = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (SCANNED.test(name)) {
      files += 1;
      findings.push(...scanContent(full, readFileSync(full).toString('latin1')));
    }
  }
}
for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.error(`missing export directory: ${dir}`);
    process.exit(2);
  }
  walk(dir);
}
for (const f of findings) console.error(`FOUND ${f.kind} in ${f.file} at byte ${f.offset}`);
console.log(`scanned ${files} files in ${dirs.length} export(s): ${findings.length} privileged credential(s) found`);
process.exit(findings.length > 0 ? 1 : 0);
