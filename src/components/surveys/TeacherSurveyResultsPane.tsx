'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Card } from '@/ui'
import { Spinner } from '@/components/Spinner'
import { TeacherSurveyResultsView } from '@/components/surveys/TeacherSurveyWorkspace'
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
  const [payloadState, setPayloadState] = useState<{ surveyId: string; payload: SurveyResultsPayload } | null>(null)
  const [error, setError] = useState('')
  const loadRequestIdRef = useRef(0)
  const currentSurveyIdRef = useRef(survey.id)
  currentSurveyIdRef.current = survey.id
  const payload = payloadState?.surveyId === survey.id ? payloadState.payload : null

  const loadResults = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const requestedSurveyId = survey.id
    setError('')
    setPayloadState(null)
    try {
      // Bypass fetchJSONWithCache for selected survey results freshness; request ids guard stale responses.
      const response = await fetch(`/api/teacher/surveys/${survey.id}/results`)
      const data = await response.json()
      if (loadRequestIdRef.current !== requestId || currentSurveyIdRef.current !== requestedSurveyId) return
      if (!response.ok) throw new Error(data.error || 'Failed to load survey results')
      setPayloadState({ surveyId: requestedSurveyId, payload: data })
    } catch (err) {
      if (loadRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setError(err instanceof Error ? err.message : 'Failed to load survey results')
        setPayloadState({
          surveyId: requestedSurveyId,
          payload: { results: [], stats: { responded: 0, total_students: survey.stats.total_students || 0 } },
        })
      }
    }
  }, [survey.id, survey.stats.total_students])

  useEffect(() => {
    void loadResults()
  }, [loadResults])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col">
        <Card tone="panel" padding="md" className="space-y-4">
          <div className="space-y-3">
            <h2 className="truncate text-xl font-semibold text-text-default">{survey.title}</h2>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <h3 className="text-base font-semibold text-text-default">Results</h3>
            </div>
          </div>
          {error ? (
            <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
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
