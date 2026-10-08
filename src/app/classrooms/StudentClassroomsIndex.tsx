'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CircularProgress,
  Button,
  Card,
  EmptyState,
  PageActionBar,
  PageContent,
  PageHeading,
  PageLayout,
  type ActionBarItem,
} from '@/ui'
import { getClassroomThemeDefinition, getClassroomThemeStyle } from '@/lib/classroom-theme'
import { formatClassroomDateRange } from '@/lib/classroom-date-range'
import {
  StudentAttendanceStatus,
  useStudentAttendanceStatusView,
} from '@/components/StudentAttendanceStatus'
import type { Classroom } from '@/types'
import { ClassroomsReadError } from './ClassroomsReadError'

interface Props {
  initialClassrooms: Classroom[]
  studentId?: string
  initialReadError?: boolean
}

export function StudentClassroomsIndex({ initialClassrooms, studentId, initialReadError = false }: Props) {
  const router = useRouter()
  const [classrooms, setClassrooms] = useState<Classroom[]>(initialClassrooms)
  const [hasSuccessfulRead, setHasSuccessfulRead] = useState(!initialReadError)
  const classroomsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (initialReadError) return
    setClassrooms(initialClassrooms)
    setHasSuccessfulRead(true)
  }, [initialClassrooms, initialReadError])
  const [openingClassroomId, setOpeningClassroomId] = useState<string | null>(null)
  const { view: attendanceView, refreshing: attendanceRefreshing, now: attendanceNow } =
    useStudentAttendanceStatusView(studentId)

  const sorted = useMemo(() => {
    return [...classrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [classrooms])

  const openClassroom = useCallback((classroom: Classroom) => {
    setOpeningClassroomId(classroom.id)
    router.push(`/classrooms/${classroom.id}?tab=today`)
  }, [router])

  if (!hasSuccessfulRead) {
    return <PageLayout density="student" width="reading"><div ref={classroomsRef} role="region" aria-label="Classrooms" tabIndex={-1}><PageContent><ClassroomsReadError onRetry={() => classroomsRef.current?.focus()} /></PageContent></div></PageLayout>
  }

  return (
    <PageLayout density="student" width="reading">
      <div ref={classroomsRef} role="region" aria-label="Classrooms" tabIndex={-1}>
      <PageActionBar
        primary={<PageHeading title="Classrooms" />}
        actions={
          [
            {
              id: 'join-classroom',
              label: 'Join classroom',
              primary: true,
              onSelect: () => router.push('/join'),
            },
          ] satisfies ActionBarItem[]
        }
      />

      <PageContent>
        {initialReadError ? <ClassroomsReadError compact onRetry={() => classroomsRef.current?.focus()} /> : null}
        {initialReadError && sorted.length === 0 ? null : sorted.length === 0 ? (
          <EmptyState
            title="No classrooms yet"
            description="Join a classroom to get your lessons, assignments, and daily work in one place."
            action={<Button onClick={() => router.push('/join')}>Join classroom</Button>}
          />
        ) : (
          <Card tone="panel" padding="none" className="overflow-hidden">
            {sorted.map((c) => {
              const theme = getClassroomThemeDefinition(c.theme_color)
              const dateRange = formatClassroomDateRange(c.start_date, c.end_date)
              return (
                <button
                  key={c.id}
                  data-testid="classroom-card"
                  data-classroom-theme-color={theme.value}
                  onClick={() => openClassroom(c)}
                  disabled={openingClassroomId !== null}
                  aria-busy={openingClassroomId === c.id}
                  style={getClassroomThemeStyle(theme.value)}
                  className={[
                    'classroom-theme classroom-theme-card classroom-theme-card-interactive relative w-full border border-border px-5 py-4 pr-14 text-left',
                    openingClassroomId === c.id ? 'cursor-wait' : 'cursor-pointer',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 truncate text-base font-semibold text-text-default">{c.title}</div>
                    {c.term_label && (
                      <div className="text-sm text-text-muted">{c.term_label}</div>
                    )}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-text-muted">
                    {dateRange ?? 'Semester dates not set'}
                  </div>
                  {studentId ? (
                    <StudentAttendanceStatus
                      state={attendanceView?.classrooms.find((item) => item.classroomId === c.id)}
                      refreshing={attendanceRefreshing}
                      now={attendanceNow}
                      variant="index"
                    />
                  ) : null}
                  {openingClassroomId === c.id && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                      <CircularProgress className="h-3.5 w-3.5" />
                      Opening classroom...
                    </div>
                  )}
                </button>
              )
            })}
          </Card>
        )}
      </PageContent>
      </div>
    </PageLayout>
  )
}
