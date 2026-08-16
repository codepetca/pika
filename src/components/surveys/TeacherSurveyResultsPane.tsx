'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Button, Card, PageState } from '@/ui'
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

type SurveyResultsState = {
  surveyId: string
  payload: SurveyResultsPayload | null
  loading: boolean
  error: string
}

interface TeacherSurveyResultsPaneProps {
  survey: SurveyWithStats
}

export function TeacherSurveyResultsPane({ survey }: TeacherSurveyResultsPaneProps) {
  const [resultsState, setResultsState] = useState<SurveyResultsState | null>(null)
  const loadRequestIdRef = useRef(0)
  const currentSurveyIdRef = useRef(survey.id)
  currentSurveyIdRef.current = survey.id
  const activeState = resultsState?.surveyId === survey.id ? resultsState : null

  const loadResults = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    const requestedSurveyId = survey.id
    setResultsState((current) => current?.surveyId === requestedSurveyId
      ? { ...current, loading: true, error: '' }
      : { surveyId: requestedSurveyId, payload: null, loading: true, error: '' })
    try {
      // Bypass fetchJSONWithCache for selected survey results freshness; request ids guard stale responses.
      const response = await fetch(`/api/teacher/surveys/${survey.id}/results`)
      const data = await response.json()
      if (loadRequestIdRef.current !== requestId || currentSurveyIdRef.current !== requestedSurveyId) return
      if (!response.ok) throw new Error(data.error || 'Failed to load survey results')
      setResultsState({ surveyId: requestedSurveyId, payload: data, loading: false, error: '' })
    } catch (err) {
      if (loadRequestIdRef.current === requestId && currentSurveyIdRef.current === requestedSurveyId) {
        setResultsState((current) => ({
          surveyId: requestedSurveyId,
          payload: current?.surveyId === requestedSurveyId ? current.payload : null,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load survey results',
        }))
      }
    }
  }, [survey.id])

  useEffect(() => {
    void loadResults()
  }, [loadResults, survey.stats.responded, survey.stats.total_students])

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
          {activeState?.payload && activeState.loading ? (
            <div className="flex items-center gap-2 text-sm text-text-muted" role="status">
              <Spinner size="sm" />
              <span>Refreshing survey results</span>
            </div>
          ) : null}
          {activeState?.payload && activeState.error ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-md border border-danger bg-danger-bg px-3 py-3 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
            >
              <p>{activeState.error} The previous results are still shown.</p>
              <Button type="button" variant="secondary" size="sm" onClick={loadResults}>
                Retry
              </Button>
            </div>
          ) : null}
          {activeState?.payload ? (
            <TeacherSurveyResultsView payload={activeState.payload} />
          ) : activeState?.error ? (
            <PageState
              kind="error"
              title="Survey results unavailable"
              description={activeState.error}
              compact
              action={(
                <Button type="button" onClick={loadResults}>
                  Retry
                </Button>
              )}
            />
          ) : (
            <PageState kind="loading" title="Loading survey results" compact />
          )}
        </Card>
      </div>
    </div>
  )
}
