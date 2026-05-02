type ClerkThemeMode = 'light' | 'dark' | 'system';

const palettes = {
  dark: {
    background: '#0a0a0a',
    card: '#171717',
    foreground: '#fafafa',
    input: '#0a0a0a',
    muted: '#9ca3af',
    border: '#262626',
    primary: '#3b82f6',
    primaryForeground: '#0a0a0a',
  },
  light: {
    background: '#ffffff',
    card: '#f9fafb',
    foreground: '#171717',
    input: '#ffffff',
    muted: '#6b7280',
    border: '#e5e7eb',
    primary: '#2563eb',
    primaryForeground: '#ffffff',
  },
  system: {
    background: 'var(--background)',
    card: 'var(--card)',
    foreground: 'var(--foreground)',
    input: 'var(--background)',
    muted: 'var(--muted-foreground)',
    border: 'var(--border)',
    primary: 'var(--primary)',
    primaryForeground: 'var(--primary-foreground)',
  },
} satisfies Record<ClerkThemeMode, Record<string, string>>;

export function createClerkAppearance(mode: ClerkThemeMode = 'system') {
  const palette = palettes[mode];

  return {
    layout: {
      logoPlacement: 'none',
      socialButtonsPlacement: 'bottom',
      socialButtonsVariant: 'blockButton',
    },
    variables: {
      borderRadius: '0.5rem',
      colorBackground: palette.card,
      colorDanger: '#ef4444',
      colorInputBackground: palette.input,
      colorInputText: palette.foreground,
      colorNeutral: palette.border,
      colorPrimary: palette.primary,
      colorSuccess: '#10b981',
      colorText: palette.foreground,
      colorTextOnPrimaryBackground: palette.primaryForeground,
      colorTextSecondary: palette.muted,
      colorWarning: '#f59e0b',
      fontFamily: 'var(--font-inter), Arial, Helvetica, sans-serif',
    },
    elements: {
      rootBox: 'mx-auto w-full max-w-[400px]',
      card: '!rounded-xl !border !border-border !bg-card !text-foreground !shadow-xl',
      footer: '!bg-card',
      footerActionLink: '!text-primary hover:!text-primary/90',
      footerActionText: '!text-muted-foreground',
      formButtonPrimary:
        '!rounded-lg !bg-primary !font-medium !text-primary-foreground transition-colors hover:!bg-primary/90',
      formFieldInput:
        '!rounded-lg !border-border !bg-background !text-foreground placeholder:!text-muted-foreground focus:!border-primary focus:!ring-primary/25',
      formFieldLabel: '!text-foreground',
      formFieldInputShowPasswordButton: '!text-muted-foreground hover:!text-foreground',
      headerSubtitle: '!text-muted-foreground',
      headerTitle: '!text-foreground',
      identityPreviewText: '!text-foreground',
      identityPreviewEditButton: '!text-primary',
      socialButtonsBlockButton:
        '!rounded-lg !border !border-border !bg-card !text-foreground transition-colors hover:!bg-accent',
      socialButtonsBlockButtonText: '!text-foreground',
      socialButtonsProviderIcon: 'hidden',
      dividerLine: '!bg-border',
      dividerText: '!text-muted-foreground',
    },
  };
}
