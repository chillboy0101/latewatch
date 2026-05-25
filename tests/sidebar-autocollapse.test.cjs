/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardLayoutPath = path.join(__dirname, '../src/components/layout/dashboard-layout.tsx');
const headerPath = path.join(__dirname, '../src/components/layout/header.tsx');
const sidebarPath = path.join(__dirname, '../src/components/layout/sidebar.tsx');

test('sidebar supports MongoDB-style auto-hide and fixed modes', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /type SidebarMode = 'auto' \| 'fixed'/);
  assert.match(source, /latewatch-sidebar-mode/);
  assert.match(source, /localStorage\.getItem\(SIDEBAR_MODE_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(SIDEBAR_MODE_STORAGE_KEY, sidebarMode\)/);
  assert.match(source, /PanelLeftOpen/);
  assert.match(source, /PanelLeftClose/);
  assert.match(source, /Pin sidebar open/);
  assert.match(source, /Use auto-hide sidebar/);
  assert.match(source, /aria-current=\{isActive \? 'page' : undefined\}/);
});

test('auto-hide sidebar stays expanded through navigation until the pointer leaves', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /let rememberedAutoExpanded = false/);
  assert.match(source, /const \[isAutoExpanded, setIsAutoExpanded\] = useState\(\(\) => rememberedAutoExpanded\)/);
  assert.match(source, /rememberedAutoExpanded = value/);
  assert.match(source, /setIsAutoExpanded\(value\)/);
  assert.match(source, /setAutoExpanded\(true\)/);
  assert.match(source, /setAutoExpanded\(false\)/);
  assert.match(source, /onMouseEnter=\{expandAutoSidebar\}/);
  assert.match(source, /onMouseLeave=\{collapseAutoSidebar\}/);
  assert.match(source, /onBlurCapture=\{handleSidebarBlur\}/);
  assert.doesNotMatch(source, /onClick=\{collapseAutoSidebar\}/);
  assert.doesNotMatch(source, /\[pathname, sidebarMode\]/);
});

test('sidebar uses longer smooth motion classes for expanding and contracting', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /SIDEBAR_MOTION_CLASS/);
  assert.match(source, /duration-\[420ms\]/);
  assert.match(source, /ease-\[cubic-bezier\(0\.22,1,0\.36,1\)\]/);
  assert.match(source, /transition-\[clip-path,box-shadow\]/);
  assert.match(source, /will-change-\[clip-path\]/);
  assert.match(source, /clipPath: isExpanded/);
  assert.match(source, /motion-reduce:transition-none/);
  assert.doesNotMatch(source, /transition-\[gap,padding/);
  assert.doesNotMatch(source, /max-w-44/);
  assert.doesNotMatch(source, /max-w-0/);
});

test('sidebar mode toggle is icon-only and glides with the rail edge', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /const toggleButtonClassName = cn\(/);
  assert.match(source, /transition-\[transform,background-color,color\]/);
  assert.match(source, /will-change-transform/);
  assert.match(source, /isExpanded \? 'translate-x-48' : 'translate-x-0'/);
  assert.match(source, /aria-label=\{toggleLabel\}/);
  assert.match(source, /title=\{toggleLabel\}/);
  assert.doesNotMatch(source, /<span className=\{labelClassName\}>\{toggleLabel\}<\/span>/);
});

test('sidebar uses a fixed icon rail so icons do not shift while expanding', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /const itemIconClassName = 'flex h-10 w-12 shrink-0 items-center justify-center'/);
  assert.match(source, /isExpanded \? 'w-full justify-start' : 'w-12 justify-start'/);
  assert.match(source, /<span className=\{itemIconClassName\} aria-hidden="true">/);
  assert.match(source, /<span className=\{itemIconClassName\} aria-hidden="true">[\s\S]*<Home className="h-5 w-5 shrink-0" \/>/);
  assert.match(source, /pointer-events-none w-0 -translate-x-1 opacity-0/);
  assert.match(source, /border-t border-border px-2 pb-14 pt-3/);
  assert.doesNotMatch(source, /pb-16/);
});

test('dashboard shell draws one continuous header divider', () => {
  const dashboardLayoutSource = fs.readFileSync(dashboardLayoutPath, 'utf8');
  const headerSource = fs.readFileSync(headerPath, 'utf8');
  const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(dashboardLayoutSource, /absolute left-0 right-0 top-16 z-50 h-px bg-border/);
  assert.match(headerSource, /className="flex h-16 items-center justify-between bg-card px-6"/);
  assert.match(sidebarSource, /className="flex h-16 items-center px-4"/);
  assert.match(sidebarSource, /!isExpanded && 'border-r border-border'/);
  assert.match(sidebarSource, /isExpanded && 'border-r border-border'/);
  assert.doesNotMatch(headerSource, /justify-between border-b border-border bg-card/);
  assert.doesNotMatch(sidebarSource, /h-16 items-center border-b border-border/);
});

test('auto-hide sidebar collapses when the browser loses focus', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /function collapseAutoSidebarForWindowExit\(\)/);
  assert.match(source, /window\.addEventListener\('blur', collapseAutoSidebarForWindowExit\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', collapseAutoSidebarForHiddenDocument\)/);
  assert.match(source, /document\.visibilityState === 'hidden'/);
  assert.match(source, /window\.removeEventListener\('blur', collapseAutoSidebarForWindowExit\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', collapseAutoSidebarForHiddenDocument\)/);
});
