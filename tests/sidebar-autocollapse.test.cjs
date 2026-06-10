/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dashboardLayoutPath = path.join(__dirname, '../src/components/layout/dashboard-layout.tsx');
const globalsPath = path.join(__dirname, '../src/app/globals.css');
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
  assert.match(source, /absolute bottom-3 left-\[14px\] z-20/);
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
  assert.match(source, /relative z-10 shrink-0 space-y-2 border-t border-border bg-card px-2 pb-14 pt-3/);
  assert.doesNotMatch(source, /pb-16/);
});

test('sidebar groups attendance routes under an accessible disclosure', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /const attendanceChildren = \[/);
  assert.match(source, /\{ name: 'Overview', href: '\/attendance', icon: ClipboardCheck \}/);
  assert.match(source, /\{ name: 'Reminders', href: '\/attendance\/reminders', icon: BellRing \}/);
  assert.match(source, /\{ name: 'Devices', href: '\/attendance\/devices', icon: Smartphone \}/);
  assert.match(source, /\{ name: 'Security Alerts', href: '\/attendance\/security-alerts', icon: ShieldAlert \}/);
  assert.match(source, /\{ name: 'Attendance', icon: ClipboardCheck, children: attendanceChildren \}/);
  assert.doesNotMatch(source, /\{ name: 'Security', href: '\/attendance\/security-alerts', icon:/);
  assert.match(source, /aria-controls=\{ATTENDANCE_NAV_ID\}/);
  assert.match(source, /aria-expanded=\{showChildren\}/);
  assert.match(source, /id=\{ATTENDANCE_NAV_ID\}/);
  assert.match(source, /tabIndex=\{showChildren \? undefined : -1\}/);
  assert.match(source, /const ChildIcon = child\.icon/);
  assert.match(source, /<ChildIcon className="h-5 w-5 shrink-0" \/>/);
  assert.match(source, /className=\{cn\(\s*itemClassName,\s*isChildActive \? activeItemClassName : inactiveItemClassName,/);
  assert.doesNotMatch(source, /ml-10 flex h-8 min-w-0 items-center rounded-md pl-2 pr-3/);
  assert.doesNotMatch(source, /ml-12 flex h-8 min-w-0 items-center rounded-md px-3/);
  assert.match(source, /const activeItemClassName = 'bg-primary text-primary-foreground'/);
  assert.match(source, /const inactiveItemClassName = 'text-muted hover:bg-background hover:text-foreground'/);
  assert.match(source, /const attendanceParentActive = attendanceSectionActive && !isExpanded/);
  assert.match(source, /'border-0 p-0 text-left',\s*attendanceParentActive \? activeItemClassName : inactiveItemClassName,/);
  assert.doesNotMatch(source, /attendanceSectionActive \? activeItemClassName : inactiveItemClassName/);
  assert.match(source, /isChildActive \? activeItemClassName : inactiveItemClassName/);
  assert.doesNotMatch(source, /bg-primary\/10 text-primary/);
});

test('attendance disclosure opens on active child routes and stays hidden in compact mode', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(source, /const navigationLeaves = navigation\.flatMap/);
  assert.match(source, /const attendanceSectionActive = attendanceChildren\.some/);
  assert.match(source, /if \(!isExpanded\) \{\s*setAttendanceDisclosureOpen\(false\);\s*return;\s*\}/);
  assert.match(source, /if \(attendanceSectionActive\) setAttendanceDisclosureOpen\(true\)/);
  assert.match(source, /\[attendanceSectionActive, isExpanded\]/);
  assert.match(source, /const showChildren = isExpanded && attendanceDisclosureOpen/);
  assert.match(source, /showChildren \? 'grid-rows-\[1fr\] opacity-100' : 'grid-rows-\[0fr\] opacity-0'/);
  assert.match(source, /className=\{cn\('min-h-0 space-y-1 overflow-hidden', showChildren && 'pt-1'\)\}/);
  assert.doesNotMatch(source, /className=\{cn\('min-h-0 overflow-hidden', showChildren && 'py-1'\)\}/);
  assert.match(source, /!isExpanded && 'hidden'/);
  assert.match(source, /showChildren && 'rotate-180'/);
  assert.match(source, /isExpanded \? 'ml-auto mr-3 w-4 opacity-70' : 'm-0 w-0 opacity-0'/);
});

test('sidebar scrolls only the middle navigation while portal controls stay fixed', () => {
  const source = fs.readFileSync(sidebarPath, 'utf8');
  const globals = fs.readFileSync(globalsPath, 'utf8');
  const navIndex = source.indexOf('aria-label="Admin navigation"');
  const mainPortalIndex = source.indexOf('aria-label="Main Portal"');
  const toggleIndex = source.indexOf('onClick={toggleSidebarMode}');

  assert.notEqual(navIndex, -1);
  assert.notEqual(mainPortalIndex, -1);
  assert.notEqual(toggleIndex, -1);
  assert.ok(navIndex < mainPortalIndex);
  assert.ok(mainPortalIndex < toggleIndex);
  assert.match(source, /className="sidebar-nav-scroll min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-3"/);
  assert.match(source, /className="relative z-10 shrink-0 space-y-2 border-t border-border bg-card px-2 pb-14 pt-3"/);
  assert.match(source, /className="flex h-16 shrink-0 items-center px-4"/);
  assert.match(globals, /\.sidebar-nav-scroll \{\s*-ms-overflow-style: none;\s*scrollbar-width: none;\s*\}/);
  assert.match(globals, /\.sidebar-nav-scroll::\-webkit-scrollbar \{\s*display: none;\s*height: 0;\s*width: 0;\s*\}/);
});

test('dashboard shell draws one continuous header divider', () => {
  const dashboardLayoutSource = fs.readFileSync(dashboardLayoutPath, 'utf8');
  const headerSource = fs.readFileSync(headerPath, 'utf8');
  const sidebarSource = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(dashboardLayoutSource, /absolute left-0 right-0 top-16 z-50 h-px bg-border/);
  assert.match(headerSource, /className="flex h-16 items-center justify-between bg-card px-6"/);
  assert.match(sidebarSource, /className="flex h-16 shrink-0 items-center px-4"/);
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
