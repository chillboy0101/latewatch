/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('the Clerk mock can only be switched on for local next dev, never in a build or on Vercel', () => {
  const config = read('next.config.ts');
  assert.match(config, /process\.env\.LATEWATCH_UI_HARNESS === "1" &&\s*process\.env\.NODE_ENV !== "production" &&\s*!process\.env\.VERCEL;/);
  assert.match(config, /\.\.\.\(uiHarness \? \{ resolveAlias: \{ "@clerk\/nextjs": "\.\/tests\/ui\/clerk-mock\.tsx" \} \} : \{\}\)/);
  // Nothing in the app imports the mock directly.
  const srcFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(full);
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  for (const file of srcFiles) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /clerk-mock/, file);
  }
});
