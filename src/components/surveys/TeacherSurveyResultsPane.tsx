'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { TeacherSurveyResultsView } from '@/components/surveys/TeacherSurveyWorkspace'
import { getSurveyStatusBadgeClass, getSurveyStatusLabel } from '@/lib/surveys'
import type { SurveyQuestionResult, SurveyWithStats } from '@/types'

type SurveyResultsPayload = {
  results: SurveyQuestionResult[]
  stats: {
    total_students: number
    responded: number
  }
}

interface TeacherSurveyResultsPaneProps {
  survey: SurveyWithStats
}

export function TeacherSurveyResultsPane({ survey }: TeacherSurveyResultsPaneProps) {
  const [payload, setPayload] = useState<SurveyResultsPayload | null>(null)
  const [error, setError] = useState('')

  const loadResults = useCallback(async () => {
    setError('')
    setPayload(null)
    try {
      const response = await fetch(`/api/teacher/surveys/${survey.id}/results`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to load survey results')
      setPayload(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load survey results')
      setPayload({ results: [], stats: { responded: 0, total_students: survey.stats.total_students || 0 } })
    }
  }, [survey.id, survey.stats.total_students])

  useEffect(() => {
    void loadResults()
  }, [loadResults])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <Card tone="panel" padding="md" className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-text-default">{survey.title}</h2>
              <p className="mt-1 text-sm text-text-muted">
                {survey.stats.responded}/{survey.stats.total_students} responded
              </p>
            </div>
            <span className={`w-max rounded-badge px-2.5 py-1 text-xs font-semibold ${getSurveyStatusBadgeClass(survey.status)}`}>
              {getSurveyStatusLabel(survey.status)}
            </span>
          </div>
          {error ? (
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </Card>

        <Card tone="panel" padding="md" className="space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-text-muted" aria-hidden="true" />
            <h3 className="text-base font-semibold text-text-default">Results</h3>
          </div>
          {payload ? (
            <TeacherSurveyResultsView payload={payload} />
          ) : (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
