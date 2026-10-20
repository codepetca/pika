import type { Metadata } from 'next'
import { headers } from 'next/headers'
import '@codepet/pal-widget/styles.css'
import './globals.scss'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { BrowserTabProvider } from '@/components/BrowserTabBranding'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import { ProgressBarProvider } from '@/components/ProgressBarProvider'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { AuthKitProvider } from '@workos-inc/authkit-nextjs/components'
import { withAuth } from '@workos-inc/authkit-nextjs'
import { isWorkOSMagicAuthPilotEnabled } from '@/lib/server/workos-pilot'

export const metadata: Metadata = {
  description: 'Classroom management for online high schools — journals, attendance, and assignments',
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
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const workOSInitialAuth = isWorkOSMagicAuthPilotEnabled()
    ? await withAuth().then(({ accessToken: _accessToken, ...auth }) => auth)
    : null

  const providers = (
    <ThemeProvider>
      <BrowserTabProvider>
        <MarkdownPreferenceProvider>
          <TooltipProvider>
            <AppMessageProvider>
              <ProgressBarProvider>
                {children}
              </ProgressBarProvider>
            </AppMessageProvider>
          </TooltipProvider>
        </MarkdownPreferenceProvider>
      </BrowserTabProvider>
    </ThemeProvider>
  )

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Pika</title>
        <link id="pika-tab-icon" rel="icon" type="image/svg+xml" href="/pika-icon-light.svg" suppressHydrationWarning />
        <meta id="pika-tab-color" name="theme-color" content="#f9fafb" suppressHydrationWarning />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-screen bg-page font-sans">
        {workOSInitialAuth
          ? <AuthKitProvider initialAuth={workOSInitialAuth} onSessionExpired={false}>{providers}</AuthKitProvider>
          : providers}
      </body>
    </html>
  )
}
