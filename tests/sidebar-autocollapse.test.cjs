/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sidebarPath = path.join(__dirname, '../src/components/layout/sidebar.tsx');

test('sidebar supports MongoDB-style auto-hide and fixed modes', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /type SidebarMode = 'auto' \| 'fixed'/);
  assert.match(source, /latewatch-sidebar-mode/);
  assert.match(source, /localStorage\.getItem\(SIDEBAR_MODE_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(SIDEBAR_MODE_STORAGE_KEY, sidebarMode\)/);
  assert.match(source, /group-hover\/sidebar:w-64/);
  assert.match(source, /group-focus-within\/sidebar:w-64/);
  assert.match(source, /PanelLeftOpen/);
  assert.match(source, /PanelLeftClose/);
  assert.match(source, /Pin sidebar open/);
  assert.match(source, /Use auto-hide sidebar/);
  assert.match(source, /aria-current=\{isActive \? 'page' : undefined\}/);
});
