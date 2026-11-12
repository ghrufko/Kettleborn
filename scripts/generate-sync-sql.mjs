// Writes the generated Cloud Save sync migration (see src/services/sync/serverSchema.ts).
// Run: npm run generate:sync-sql   — never applies anything; it only writes the .sql file.
import { writeFileSync } from 'node:fs';

const { generateSyncMigrationSql, SYNC_MIGRATION_FILE } = await import(
  new URL('../src/services/sync/serverSchema.ts', import.meta.url).href
);
writeFileSync(new URL(`../${SYNC_MIGRATION_FILE}`, import.meta.url), generateSyncMigrationSql());
console.log(`wrote ${SYNC_MIGRATION_FILE}`);
