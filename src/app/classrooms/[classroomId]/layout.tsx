import { cookies } from 'next/headers'
import { LayoutInitialStateProvider } from '@/components/layout'
import { parseLeftSidebarCookie, COOKIE_NAMES } from '@/lib/layout-config'

export default function ClassroomLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const leftSidebarCookie = cookies().get(COOKIE_NAMES.leftSidebar)?.value
  const leftSidebarExpanded = parseLeftSidebarCookie(leftSidebarCookie)

  return (
    <LayoutInitialStateProvider leftSidebarExpanded={leftSidebarExpanded}>
      {children}
    </LayoutInitialStateProvider>
  )
}
