import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader'
import { AuthSessionWatcher } from './AuthSessionWatcher'
import type { ClassroomThemeColor } from '@/lib/classroom-theme'

interface AppShellProps {
  children: ReactNode
  navigation?: ReactNode
  showHeader?: boolean
  user?: {
    id: string
    email: string
    role: 'student' | 'teacher'
    first_name?: string | null
    last_name?: string | null
  }
  classrooms?: Array<{
    id: string
    title: string
    code: string
    themeColor: ClassroomThemeColor
  }>
  currentClassroomId?: string
  onOpenSidebar?: () => void
  sidebarTriggerLabel?: string
  onNavigateHome?: (href: string) => boolean
  mainClassName?: string
  constrainToViewport?: boolean
  /** Also bound narrow-screen workspaces that own their internal scrolling. */
  constrainToViewportOnMobile?: boolean
  examModeHeader?: {
    testTitle: string
    exitsCount: number
    awayTotalSeconds: number
  } | null
  pageTitle?: ReactNode
}

/**
 * Global layout wrapper for all authenticated pages.
 * Provides compact header (48px) and consistent page container.
 */
export function AppShell({
  children,
  navigation,
  showHeader = true,
  user,
  classrooms,
  currentClassroomId,
  onOpenSidebar,
  sidebarTriggerLabel,
  onNavigateHome,
  mainClassName,
  constrainToViewport = false,
  constrainToViewportOnMobile = false,
  examModeHeader,
  pageTitle,
}: AppShellProps) {
  const shouldConstrainViewport = constrainToViewport || !!examModeHeader
  const viewportClassName = shouldConstrainViewport
    ? constrainToViewportOnMobile ? 'h-dvh overflow-hidden' : 'lg:h-dvh lg:overflow-hidden'
    : ''

  return (
    <div className={['flex min-h-dvh flex-col bg-page', viewportClassName].filter(Boolean).join(' ')}>
      {user && <AuthSessionWatcher expectedUserId={user.id} expectedRole={user.role} />}
      {showHeader && (
        <AppHeader
          user={user}
          classrooms={classrooms}
          currentClassroomId={currentClassroomId}
          onOpenSidebar={onOpenSidebar}
          sidebarTriggerLabel={sidebarTriggerLabel}
          onNavigateHome={onNavigateHome}
          examModeHeader={examModeHeader}
          pageTitle={pageTitle}
        />
      )}
      {navigation}
      <main
        className={[
          'flex-1 min-h-0 w-full',
          shouldConstrainViewport ? constrainToViewportOnMobile ? 'overflow-hidden' : 'lg:overflow-hidden' : '',
          mainClassName || 'max-w-7xl mx-auto px-4 py-3',
        ].filter(Boolean).join(' ')}
      >
        {children}
      </main>
    </div>
  )
}
