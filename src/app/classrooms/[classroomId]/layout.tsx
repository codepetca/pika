import { cookies } from 'next/headers'
import { ClassroomSidebarProvider } from '@/components/ClassroomSidebarProvider'
import { parseClassroomSidebarWidthCookie } from '@/lib/classroom-sidebar'

export default function ClassroomLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sidebarCookie = cookies().get('pika_sidebar')?.value
  const initialCollapsed = sidebarCookie === 'collapsed'
  const initialWidth = parseClassroomSidebarWidthCookie(
    cookies().get('pika_sidebar_w')?.value
  )

  return (
    <ClassroomSidebarProvider
      initialCollapsed={initialCollapsed}
      initialExpandedWidth={initialWidth}
    >
      {children}
    </ClassroomSidebarProvider>
  )
}
