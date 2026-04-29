import type { Metadata } from 'next'
import './globals.scss'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProgressBarProvider } from '@/components/ProgressBarProvider'
import { AppMessageProvider, TooltipProvider } from '@/ui'

export const metadata: Metadata = {
  title: 'Pika',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-page">
        <ThemeProvider>
          <TooltipProvider>
            <AppMessageProvider>
              <ProgressBarProvider>
                {children}
              </ProgressBarProvider>
            </AppMessageProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
