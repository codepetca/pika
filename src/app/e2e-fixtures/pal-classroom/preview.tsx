'use client'

import { useEffect, useMemo, useState } from 'react'
import { PalAchievements } from '@codepet/pal-widget'
import { StudentPalExperience } from '@/integrations/pal'
import { StudentAchievementsRecovery, StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'
import { Button, Input, PageHeading, PageLayout, TabContentTransition } from '@/ui'

/** Throws until the fixture controller explicitly disarms it, including React replay. */
function ControlledRoadmap({ armed }: { armed: boolean }) {
  if (armed) throw new Error('PIKA_ACHIEVEMENTS_FIXTURE_RENDER_FAILURE')
  return <PalAchievements />
}

function RecoveryFixture() {
  const [armed, setArmed] = useState(false)
  const [active, setActive] = useState(true)
  return (
    <>
      <div className="flex flex-wrap gap-2 py-3">
        <Button type="button" variant="secondary" onClick={() => setArmed(true)}>Cause roadmap render failure</Button>
        <Button type="button" variant="secondary" onClick={() => setArmed(false)}>Allow roadmap render</Button>
        <Button type="button" variant="secondary" onClick={() => setActive(value => !value)}>
          {active ? 'Hide roadmap' : 'Show roadmap'}
        </Button>
      </div>
      <TabContentTransition isActive={active}>
        <StudentAchievementsRecovery>
          <ControlledRoadmap armed={armed} />
        </StudentAchievementsRecovery>
      </TabContentTransition>
    </>
  )
}

/** Synthetic browser harness. Network fixtures are supplied by Playwright. */
export function PalClassroomFixture({ recoveryEnabled = false }: { recoveryEnabled?: boolean }) {
  const [classroom, setClassroom] = useState<'a' | 'b'>('a')
  const [loggedIn, setLoggedIn] = useState(true)
  const [origin, setOrigin] = useState<string | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])
  const membership = useMemo(() => ({
    classroomId: `c1690000-0000-4000-8000-00000000001${classroom === 'a' ? '0' : '1'}`,
    scopeKey: `pika-classroom-v1-${classroom.repeat(64)}`,
  }), [classroom])
  return (
    <PageLayout width="wide" className="p-4 sm:p-8">
      <PageHeading title={loggedIn ? `Classroom ${classroom.toUpperCase()}` : 'Signed out'} />
      <div className="flex gap-2">
        <Button onClick={() => setClassroom(classroom === 'a' ? 'b' : 'a')}>Switch classroom</Button>
        <Button onClick={() => setLoggedIn(false)}>Sign out</Button>
      </div>
      <p>Academic work remains available</p>
      {loggedIn && origin ? (
        <StudentPalExperience key={membership.scopeKey} apiBaseUrl={origin}
          scopeKey={membership.scopeKey} membership={membership}>
          <Input aria-label="Academic draft" placeholder="Academic draft" />
          {recoveryEnabled ? <RecoveryFixture /> : <StudentAchievementsTab />}
        </StudentPalExperience>
      ) : null}
    </PageLayout>
  )
}
