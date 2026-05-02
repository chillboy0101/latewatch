import { dark } from '@clerk/themes';

type ClerkThemeMode = 'light' | 'dark';

export function createClerkAppearance(mode: ClerkThemeMode = 'light') {
  const appearance = {
    layout: {
      logoImageUrl: '/latewatch-logo.png',
      logoPlacement: 'inside',
      socialButtonsPlacement: 'bottom',
      socialButtonsVariant: 'blockButton',
    },
    variables: {
      borderRadius: '0.5rem',
      fontFamily: 'var(--font-inter), Arial, Helvetica, sans-serif',
    },
    elements: {
      rootBox: 'mx-auto w-full max-w-[400px]',
      card: '!rounded-xl !shadow-xl',
    },
  };

  if (mode === 'dark') {
    return {
      ...appearance,
      baseTheme: dark,
    };
  }

  return appearance;
}
