'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, EmptyState } from '@/ui'
import { PageActionBar, PageContent, PageLayout, type ActionBarItem } from '@/components/PageLayout'
import type { Classroom } from '@/types'

interface Props {
  initialClassrooms: Classroom[]
}

export function StudentClassroomsIndex({ initialClassrooms }: Props) {
  const router = useRouter()
  const [classrooms] = useState<Classroom[]>(initialClassrooms)

  const sorted = useMemo(() => {
    return [...classrooms].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [classrooms])

  return (
    <PageLayout className="max-w-5xl mx-auto">
      <PageActionBar
        primary={
          <h1 className="text-2xl font-bold text-text-default">Classrooms</h1>
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
                onClick={() => router.push(`/classrooms/${c.id}?tab=today`)}
                className="w-full cursor-pointer border-b border-border px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-surface-accent"
              >
                <div className="text-base font-semibold text-text-default">{c.title}</div>
                <div className="mt-1 text-sm leading-6 text-text-muted">
                  Code: <span className="font-mono">{c.class_code}</span>
                  {c.term_label ? ` • ${c.term_label}` : ''}
                </div>
              </button>
            ))}
          </Card>
        )}
      </PageContent>
    </PageLayout>
  )
}
