import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'

export const metadata: Metadata = {
  title: 'Pika - Student Daily Log & Attendance',
  description: 'Online high school student daily log and attendance tracking',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
