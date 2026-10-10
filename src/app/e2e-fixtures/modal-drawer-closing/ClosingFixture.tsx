'use client'

import { useState } from 'react'
import { Button, Card, FormField, Input } from '@/ui'
import { LeftSidebar, NavItems, ThreePanelProvider, useMobileDrawer } from '@/components/layout'
import { TeacherClassroomJoinQrDialog } from '@/app/classrooms/[classroomId]/TeacherClassroomJoinQrDialog'

export function ClosingFixture({ role }: { role: 'teacher' | 'student' }) {
  return <ThreePanelProvider routeKey="calendar-teacher" initialLeftExpanded={false} persistLeftSidebar={false}>
    <Examples role={role} />
  </ThreePanelProvider>
}

function Examples({ role }: { role: 'teacher' | 'student' }) {
  const { openLeft, isLeftOpen } = useMobileDrawer()
  const [qrOpen, setQrOpen] = useState(false)
  const [draft, setDraft] = useState('Preserved workspace draft')
  const [blockHome, setBlockHome] = useState(false)
  const [selected, setSelected] = useState('announcements')
  const navigation = (expanded?: boolean) => <NavItems expanded={expanded}
    classroomId="synthetic-closing" role={role} activeTab={selected}
    onTabChange={setSelected} updateSearchParams={() => {}} />
  return <main className="min-h-screen bg-page p-4">
    <Card className="mx-auto mt-80 max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold text-text-default">Closing continuity</h1>
      <FormField label="Workspace draft"><Input value={draft} onChange={event => setDraft(event.target.value)} /></FormField>
      <p role="status" className="text-text-muted">Selected tab: {selected}</p>
      <Button className="lg:hidden" aria-haspopup="dialog" aria-expanded={isLeftOpen} onClick={openLeft}>Open navigation</Button>
      <Button variant="secondary" aria-pressed={blockHome} onClick={() => setBlockHome(value => !value)}>Block home navigation</Button>
      {role === 'teacher' && <Button onClick={() => setQrOpen(true)}>Open join QR</Button>}
    </Card>
    <div className="h-screen" aria-hidden="true" />
    <div className="hidden" aria-hidden="true">
      <LeftSidebar exitMotion="opacity" mobileChildren={navigation(true)} mobileHomeHref="#workspace"
        onNavigateHome={() => !blockHome}>{navigation()}</LeftSidebar>
    </div>
    {role === 'teacher' && <TeacherClassroomJoinQrDialog isOpen={qrOpen} onClose={() => setQrOpen(false)}
      classroomTitle="Example classroom" joinCode="CODE12" joinUrl="https://example.invalid/join/CODE12" onCopyLink={() => {}} />}
  </main>
}
