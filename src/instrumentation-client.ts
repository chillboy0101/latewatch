import { routerNavigationStarting } from '@/lib/app-nav';

// Runs in the browser before the app starts. Next.js calls this as every router navigation starts,
// the app's own taps and plain links alike, so the back-and-forth handling (see app-nav) sees them all.
export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  routerNavigationStarting(navigationType, url);
}
