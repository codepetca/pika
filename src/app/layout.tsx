import type { Metadata } from 'next'
import './globals.css'

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
      <body className="min-h-screen bg-gray-50">
        {children}
      </body>
    </html>
  )
}
