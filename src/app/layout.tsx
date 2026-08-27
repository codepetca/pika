import type { Metadata } from 'next'
import '@codepet/pal-widget/styles.css'
import './globals.scss'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import { ProgressBarProvider } from '@/components/ProgressBarProvider'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { shouldUseWorkOSAuthKit } from '@/lib/auth-mode'

export const metadata: Metadata = {
  title: 'Pika',
  description: 'Classroom management for online high schools — journals, attendance, and assignments',
  icons: {
    icon: [
      {
        url: '/pika-icon-light.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/pika-icon-dark.svg',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
}

const themeInitScript = `
(() => {
  const root = document.documentElement;
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem('theme');
  } catch {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : (prefersDark ? 'dark' : 'light');
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#030712' : '#f9fafb';
})();
`

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const workOSInitialAuth = shouldUseWorkOSAuthKit()
    ? await withAuth().then(({ accessToken: _accessToken, ...auth }) => auth)
    : null

  const providers = (
    <ThemeProvider>
      <MarkdownPreferenceProvider>
        <TooltipProvider>
          <AppMessageProvider>
            <ProgressBarProvider>
              {children}
            </ProgressBarProvider>
          </AppMessageProvider>
        </TooltipProvider>
      </MarkdownPreferenceProvider>
    </ThemeProvider>
  )

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-page font-sans">
        {workOSInitialAuth
          ? <AuthKitProvider initialAuth={workOSInitialAuth} onSessionExpired={false}>{providers}</AuthKitProvider>
          : providers}
      </body>
    </html>
  )
}
