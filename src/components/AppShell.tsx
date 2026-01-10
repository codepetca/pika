import { ReactNode } from 'react'
import { AppHeader } from './AppHeader'

interface AppShellProps {
  children: ReactNode
  showHeader?: boolean
  user?: {
    email: string
    role: 'student' | 'teacher'
  }
  classrooms?: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
  onOpenSidebar?: () => void
  mainClassName?: string
}

/**
 * Global layout wrapper for all authenticated pages.
 * Provides compact header (48px) and consistent page container.
 */
export function AppShell({
  children,
  showHeader = true,
  user,
  classrooms,
  currentClassroomId,
  currentTab,
  onOpenSidebar,
  mainClassName,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {showHeader && (
        <AppHeader
          user={user}
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          currentTab={currentTab}
          onOpenSidebar={onOpenSidebar}
        />
      )}
      <main className={mainClassName || 'max-w-7xl mx-auto px-4 py-3'}>
        {children}
      </main>
    </div>
  )
}
