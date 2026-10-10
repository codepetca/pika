'use client'

import { useState } from 'react'
import { Button, Card, FormField, Input } from '@/ui'
import { LeftSidebar, NavItems, RightSidebar, ThreePanelProvider, useMobileDrawer } from '@/components/layout'

/** Actual drawer owners with local content; Calendar is the enabled production configuration. */
export function MobileDrawerControlsPattern({ role }: { role: 'teacher' | 'student' }) {
  return (
    <section id="mobile-drawer-controls" data-testid="mobile-drawer-controls" className="space-y-4 scroll-mt-28">
      <h2 className="font-semibold">Shared mobile drawer controls</h2>
      <p className="text-sm text-text-muted">
        Navigation serves both roles. The right drawer is enabled for teacher Calendar;
        the student presentation below exercises the shared owner with fixed content.
      </p>
      <ThreePanelProvider routeKey="calendar-teacher" initialLeftExpanded={false} persistLeftSidebar={false} initialRightOpen={false}>
        <DrawerExample role={role} />
      </ThreePanelProvider>
    </section>
  )
}

function DrawerExample({ role }: { role: 'teacher' | 'student' }) {
  const { isLeftOpen, isRightOpen, openLeft, openRight } = useMobileDrawer()
  const [minimal, setMinimal] = useState(false)
  const [draft, setDraft] = useState('Retained drawer example draft')
  const [blockHome, setBlockHome] = useState(false)
  const navigation = (expanded?: boolean) => <NavItems expanded={expanded}
    classroomId="pattern-lab" role={role} activeTab="announcements"
    onTabChange={() => {}} updateSearchParams={() => {}} />

  return (
    <Card tone="panel" padding="md" className="space-y-4">
      <FormField label="Drawer example draft">
        <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" aria-pressed={minimal} onClick={() => setMinimal((value) => !value)}>
          Minimal drawer header
        </Button>
        <Button variant="secondary" aria-pressed={blockHome} onClick={() => setBlockHome((value) => !value)}>
          Block drawer home navigation
        </Button>
      </div>
      <div className="flex flex-wrap gap-3 lg:hidden">
        <Button variant="secondary" aria-haspopup="dialog" aria-expanded={isLeftOpen} onClick={openLeft}>
          Open example navigation drawer
        </Button>
        <Button variant="secondary" aria-haspopup="dialog" aria-expanded={isRightOpen} onClick={openRight}>
          Open example detail drawer
        </Button>
      </div>
      <p className="text-sm text-text-muted">Drawer commands appear below the desktop breakpoint.</p>
      <div className="hidden" aria-hidden="true">
        <LeftSidebar exitMotion="opacity" mobileChildren={navigation(true)}
          mobileHomeHref="#mobile-drawer-controls" onNavigateHome={() => !blockHome}>
          {navigation()}
        </LeftSidebar>
        <RightSidebar title="Drawer example details" minimalMobileHeader={minimal}>
          <p className="p-3 text-sm text-text-default">Fixed {role} detail content.</p>
        </RightSidebar>
      </div>
    </Card>
  )
}
