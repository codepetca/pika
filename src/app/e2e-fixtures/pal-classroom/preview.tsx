'use client'

import { useEffect, useMemo, useState } from 'react'
import { StudentPalExperience } from '@/integrations/pal'
import { StudentAchievementsTab } from '@/app/classrooms/[classroomId]/StudentAchievementsTab'
import { Button, PageHeading, PageLayout } from '@/ui'

/** Synthetic browser harness. Network fixtures are supplied by Playwright. */
export function PalClassroomFixture() {
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
          <StudentAchievementsTab />
        </StudentPalExperience>
      ) : null}
    </PageLayout>
  )
}
