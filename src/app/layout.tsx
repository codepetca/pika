import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
  title: 'Pika - Student Daily Log & Attendance',
  description: 'Online high school student daily log and attendance tracking',
}

const themeInitScript = `
(() => {
  try {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark' || storedTheme === 'light') {
      document.documentElement.classList.toggle('dark', storedTheme === 'dark');
      return;
    }
  } catch {}
  const prefersDark = document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', prefersDark);
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
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
