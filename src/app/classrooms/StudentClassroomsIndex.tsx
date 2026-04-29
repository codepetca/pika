'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle } from 'lucide-react'
import { Button, Card, EmptyState } from '@/ui'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import type { Classroom } from '@/types'

interface Props {
  initialClassrooms: Classroom[]
}

export function StudentClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const [classrooms] = useState<Classroom[]>(initialClassrooms)
  const [openingClassroomId, setOpeningClassroomId] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...classrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [classrooms])

  const openClassroom = useCallback((classroom: Classroom) => {
    setOpeningClassroomId(classroom.id)
    router.push(`/classrooms/${classroom.id}?tab=today`)
  }, [router])

  return (
    <PageLayout className="mx-auto max-w-6xl">
      <PageActionBar
        primary={
          <h1 className="text-3xl font-bold text-text-default">Classrooms</h1>
        }
        actions={
          [
            {
              id: 'join-classroom',
              label: '+ Join classroom',
              onSelect: () => router.push('/join'),
            },
          ] satisfies ActionBarItem[]
        }
      />

      <PageContent>
        {sorted.length === 0 ? (
          <EmptyState
            title="No classrooms yet"
            description="Join a classroom to get your lessons, assignments, and daily work in one place."
            action={<Button onClick={() => router.push('/join')}>Join classroom</Button>}
          />
        ) : (
          <Card tone="panel" padding="none" className="overflow-hidden">
            {sorted.map((c) => (
              <button
                key={c.id}
                data-testid="classroom-card"
                onClick={() => openClassroom(c)}
                disabled={openingClassroomId !== null}
                aria-busy={openingClassroomId === c.id}
                className={[
                  'w-full border-b border-border px-5 py-4 text-left transition-colors last:border-b-0',
                  openingClassroomId === c.id ? 'cursor-wait bg-surface-accent' : 'cursor-pointer hover:bg-surface-accent',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="text-base font-semibold text-text-default">{c.title}</div>
                  {c.term_label && (
                    <div className="text-sm text-text-muted">{c.term_label}</div>
                  )}
                </div>
                <div className="mt-1 text-sm leading-6 text-text-muted">
                  Code: <span className="font-mono tracking-[0.18em]">{c.class_code}</span>
                </div>
                {openingClassroomId === c.id && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Opening classroom...
                  </div>
                )}
              </button>
            ))}
          </Card>
        )}
      </PageContent>
    </PageLayout>
  )
}
