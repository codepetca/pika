'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/ui'
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
          <div className="bg-surface rounded-lg shadow-sm border border-border p-10 text-center">
            <h2 className="text-lg font-semibold text-text-default">No classrooms yet</h2>
            <div className="mt-6">
              <Button onClick={() => router.push('/join')}>
                Join classroom
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border">
            {sorted.map((c) => (
              <button
                key={c.id}
                data-testid="classroom-card"
                onClick={() => router.push(`/classrooms/${c.id}?tab=today`)}
                className="w-full p-4 text-left hover:bg-surface-hover transition-colors cursor-pointer"
              >
                <div className="text-sm font-semibold text-text-default">{c.title}</div>
                <div className="mt-1 text-sm text-text-muted">
                  Code: <span className="font-mono">{c.class_code}</span>
                  {c.term_label ? ` • ${c.term_label}` : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </PageContent>
    </PageLayout>
  )
}
