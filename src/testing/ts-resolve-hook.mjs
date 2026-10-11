// Minimal ESM resolver hook for `node --test`. Node's native loader
// requires explicit file extensions on relative specifiers, but this
// codebase — like the rest of the TypeScript/Metro ecosystem — writes
// extensionless relative imports everywhere (`from './client'`, not
// `from './client.ts'`), which is correct under tsconfig's
// "moduleResolution": "bundler" and what Metro/tsc both already resolve.
// This hook lets `node --test` import the real, unmodified source files
// by retrying a failed resolution with `.ts` appended before giving up.
// See src/testing/README.md for how this is wired into the test runner.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = /^\.\.?\//.test(specifier);
    const hasNoExtension = !/\.[a-zA-Z0-9]+$/.test(specifier);
    if (isRelative && hasNoExtension && (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT')) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        // Directory import (e.g. `../models` -> `../models/index.ts`).
        return nextResolve(`${specifier}/index.ts`, context);
      }
    }
    throw err;
  }
}
