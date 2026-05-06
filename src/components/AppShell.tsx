import { ReactNode } from 'react'
import { AppHeader } from './AppHeader'

interface AppShellProps {
  children: ReactNode
  showHeader?: boolean
  user?: {
    email: string
    role: 'student' | 'teacher'
    first_name?: string | null
    last_name?: string | null
  }
  classrooms?: Array<{
    id: string
    title: string
    code: string
  }>
  currentClassroomId?: string
  currentTab?: string
  onOpenSidebar?: () => void
  onNavigateHome?: (href: string) => boolean
  onNavigateClassroom?: (href: string) => boolean
  mainClassName?: string
  constrainToViewport?: boolean
  examModeHeader?: {
    testTitle: string
    exitsCount: number
    awayTotalSeconds: number
  } | null
  pageTitle?: string
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
  onNavigateHome,
  onNavigateClassroom,
  mainClassName,
  constrainToViewport = false,
  examModeHeader,
  pageTitle,
}: AppShellProps) {
  const shouldConstrainViewport = constrainToViewport || !!examModeHeader

  return (
    <div className={`flex min-h-dvh flex-col bg-page${shouldConstrainViewport ? ' lg:h-dvh lg:overflow-hidden' : ''}`}>
      {showHeader && (
        <AppHeader
          user={user}
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          currentTab={currentTab}
          onOpenSidebar={onOpenSidebar}
          onNavigateHome={onNavigateHome}
          onNavigateClassroom={onNavigateClassroom}
          examModeHeader={examModeHeader}
          pageTitle={pageTitle}
        />
      )}
      <main
        className={[
          'flex-1 min-h-0',
          shouldConstrainViewport ? 'lg:overflow-hidden' : '',
          mainClassName || 'max-w-7xl mx-auto px-4 py-3',
        ].filter(Boolean).join(' ')}
      >
        {children}
      </main>
    </div>
  )
}
