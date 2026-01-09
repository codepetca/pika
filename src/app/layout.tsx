import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
  title: 'Pika - Student Daily Log & Attendance',
  description: 'Online high school student daily log and attendance tracking',
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
      <body className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
