'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { PageActionBar, PageContent, PageLayout } from '@/components/PageLayout'
import { getAttendanceIcon } from '@/lib/attendance'
import type { AttendanceStatus, ClassDay, Classroom, Entry } from '@/types'

interface HistoryRow {
  date: string
  status: AttendanceStatus
  entry: Entry | null
}

interface Props {
  classroom: Classroom
}

export function StudentHistoryTab({ classroom }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const classDaysRes = await fetch(`/api/classrooms/${classroom.id}/class-days`)
        const classDaysData = await classDaysRes.json()
        const classDays: ClassDay[] = (classDaysData.class_days || []).filter((d: ClassDay) => d.is_class_day)

        const entriesRes = await fetch(`/api/student/entries?classroom_id=${classroom.id}`)
        const entriesData = await entriesRes.json()
        const entries: Entry[] = entriesData.entries || []

        const entryMap = new Map(entries.map(e => [e.date, e]))

        const nextRows = classDays
          .map(day => {
            const entry = entryMap.get(day.date) || null
            return { date: day.date, entry, status: entry ? 'present' : 'absent' as AttendanceStatus }
          })
          .sort((a, b) => b.date.localeCompare(a.date))

        setRows(nextRows)
      } catch (err) {
        console.error('Error loading history:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [classroom.id])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <PageLayout>
      <PageActionBar
        primary={<div className="text-sm font-medium text-text-default">History</div>}
      />
      <PageContent>
        <div className="bg-surface rounded-lg shadow-sm">
          <div className="divide-y divide-border">
            {rows.slice(0, 60).map((row) => (
              <div key={row.date} className="p-4 flex items-center justify-between">
                <div className="text-sm text-text-muted">{row.date}</div>
                <div className="text-xl" aria-label={row.status}>
                  {getAttendanceIcon(row.status)}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="p-6 text-center text-text-muted">No class days yet</div>
            )}
          </div>
        </div>
      </PageContent>
    </PageLayout>
  )
}
