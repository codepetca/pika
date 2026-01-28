import { cookies } from 'next/headers'
import { LayoutInitialStateProvider } from '@/components/layout'
import { parseLeftSidebarCookie, COOKIE_NAMES } from '@/lib/layout-config'

export default async function ClassroomLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const leftSidebarCookie = cookieStore.get(COOKIE_NAMES.leftSidebar)?.value
  const leftSidebarExpanded = parseLeftSidebarCookie(leftSidebarCookie)

  return (
    <LayoutInitialStateProvider leftSidebarExpanded={leftSidebarExpanded}>
      {children}
    </LayoutInitialStateProvider>
  )
}
