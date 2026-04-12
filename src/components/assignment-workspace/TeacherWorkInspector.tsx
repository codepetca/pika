'use client'

import { Fragment, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { HistoryList } from '@/components/HistoryList'
import { Spinner } from '@/components/Spinner'
import { Button, SplitButton, Tooltip } from '@/ui'
import type {
  AssignmentDocHistoryEntry,
  AssignmentFeedbackEntry,
  AssignmentRepoReviewResult,
  AuthenticityFlag,
} from '@/types'
import type { InspectorSectionId, StudentWorkData } from './types'

type GradeSaveMode = 'draft' | 'graded'

function AuthenticityGauge({ score, flags }: { score: number | null; flags: AuthenticityFlag[] }) {
  const hasScore = score !== null
  const displayScore = score ?? 0
  const color = !hasScore
    ? 'bg-surface-2'
    : displayScore >= 70
      ? 'bg-green-500'
      : displayScore >= 40
        ? 'bg-yellow-500'
        : 'bg-red-500'
  const textColor = !hasScore
    ? 'text-text-muted'
    : displayScore >= 70
      ? 'text-green-700'
      : displayScore >= 40
        ? 'text-yellow-700'
        : 'text-red-700'

  const bar = (
    <div className="relative h-5 overflow-hidden rounded-full bg-surface-2">
      {hasScore && (
        <div className={`h-full rounded-full ${color}`} style={{ width: `${displayScore}%` }} />
      )}
      <span
        className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${textColor}`}
      >
        Authenticity {hasScore ? `${displayScore}%` : '—'}
      </span>
    </div>
  )

  if (flags.length === 0) return bar

  return (
    <Tooltip
      content={
        <div className="space-y-1 py-0.5">
          {flags.map((flag, index) => (
            <div key={index}>
              {flag.reason === 'paste'
                ? `${flag.wordDelta} words pasted`
                : `${flag.wordDelta} words in ${flag.seconds}s (${Math.round(flag.wps * 60)} wpm)`}
            </div>
          ))}
        </div>
      }
    >
      <div>{bar}</div>
    </Tooltip>
  )
}

function RepoMetricBar({
  label,
  value,
  tone = 'primary',
}: {
  label: string
  value: number
  tone?: 'primary' | 'muted'
}) {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)))
  const fillClass = tone === 'primary' ? 'bg-primary' : 'bg-surface-hover'

  return (
    <div className="relative h-6 overflow-hidden rounded-full border border-border bg-surface">
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] ${fillClass}`}
        style={{ width: `${percentage}%` }}
      />
      <div className="absolute inset-0 z-10 flex items-center justify-between px-3 text-[10px] font-semibold leading-none">
        <span className="text-text-default">{label}</span>
        <span className="text-text-default">{percentage}%</span>
      </div>
    </div>
  )
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const quickScores = Array.from({ length: 11 }, (_, index) => index)
  const numericValue = Number(value)
  const selected = Number.isInteger(numericValue) && numericValue >= 0 && numericValue <= 10
    ? numericValue
    : null

  return (
    <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_4.75rem] items-center gap-x-2">
      <label
        className={[
          'whitespace-nowrap text-[11px] font-medium text-text-muted',
          label === 'Completion' ? 'pr-2' : 'pr-1',
        ].join(' ')}
      >
        {label}
      </label>
      <div className="flex min-w-0 items-center justify-start gap-0">
        {quickScores.map((score) => {
          const isActive = selected === score
          return (
            <Tooltip key={score} content={score} delayDuration={0} side="top">
              <button
                type="button"
                onClick={() => onChange(String(score))}
                className={[
                  'inline-flex h-6 w-[clamp(0.5rem,calc(100%/11),1.5rem)] flex-none items-center justify-center rounded border px-0 text-[10px] font-semibold leading-none transition-colors',
                  isActive
                    ? 'border-primary bg-primary text-text-inverse'
                    : 'border-border bg-surface text-text-default hover:bg-surface-hover',
                ].join(' ')}
                aria-label={`Set ${label} score to ${score}`}
                aria-pressed={isActive}
              />
            </Tooltip>
          )
        })}
      </div>
      <div className="grid h-8 grid-cols-[1fr_auto] overflow-hidden rounded border border-border bg-surface">
        <input
          type="number"
          min={0}
          max={10}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 border-0 bg-transparent px-2 text-center text-sm font-semibold text-text-default [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label={`${label} score`}
        />
        <div className="flex min-w-[2rem] items-center justify-center border-l border-border bg-surface-2 px-1.5 text-xs font-medium text-text-muted">
          10
        </div>
      </div>
    </div>
  )
}

function InspectorSection({
  id,
  title,
  expanded,
  summary,
  onToggle,
  action,
  children,
}: {
  id: InspectorSectionId
  title: string
  expanded: boolean
  summary?: ReactNode
  onToggle: () => void
  action?: ReactNode
  children?: ReactNode
}) {
  const contentId = `assignment-inspector-section-${id}`

  return (
    <section
      data-testid={`inspector-section-${id}`}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex items-start gap-3 p-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={title}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={onToggle}
        >
          <div className="flex min-w-0 items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-text-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
            )}
            <span className="shrink-0 text-sm font-semibold text-text-default">{title}</span>
            {summary ? <div className="min-w-0 flex-1">{summary}</div> : null}
          </div>
        </button>
        {expanded && action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {expanded && (
        <div id={contentId} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  )
}

function RepoSummary({
  repoReviewResult,
  hasRepoConnection,
}: {
  repoReviewResult: AssignmentRepoReviewResult | null
  hasRepoConnection: boolean
}) {
  if (!hasRepoConnection) {
    return <RepoMetricBar label="No repo linked" value={0} tone="muted" />
  }

  if (!repoReviewResult) {
    return <RepoMetricBar label="Analysis not run" value={0} tone="muted" />
  }

  const compositeScore =
    ((repoReviewResult.relative_contribution_share || 0) +
      (repoReviewResult.spread_score || 0) +
      (repoReviewResult.iteration_score || 0)) /
    3

  return <RepoMetricBar label="Repo analysis" value={compositeScore} />
}

function ScoreTotalBox({ value, total }: { value: number; total: number }) {
  return (
    <div className="grid h-8 grid-cols-[1fr_auto] overflow-hidden rounded border border-border bg-surface">
      <div className="flex min-w-[2.75rem] items-center justify-center px-2 text-sm font-semibold text-text-default">
        {value}
      </div>
      <div className="flex min-w-[2rem] items-center justify-center border-l border-border bg-surface-2 px-1.5 text-xs font-medium text-text-muted">
        {total}
      </div>
    </div>
  )
}

function GradeSummary({ totalPercent }: { totalPercent: number }) {
  const tone =
    totalPercent >= 80
      ? 'border-green-200 bg-green-100 text-green-700'
      : totalPercent >= 60
        ? 'border-yellow-200 bg-yellow-100 text-yellow-700'
        : totalPercent >= 50
          ? 'border-orange-200 bg-orange-100 text-orange-700'
          : 'border-red-200 bg-red-100 text-red-700'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={[
          'inline-flex h-8 items-center justify-center rounded border px-2.5 text-sm font-medium',
          tone,
        ].join(' ')}
      >
        {totalPercent}%
      </span>
    </div>
  )
}

export function TeacherWorkInspector({
  data,
  historyEntries,
  historyLoading,
  historyError,
  previewEntry,
  onEntryClick,
  onEntryHover,
  onHistoryMouseLeave,
  isPreviewLocked,
  onExitPreview,
  repoReviewResult,
  scoreCompletion,
  setScoreCompletion,
  scoreThinking,
  setScoreThinking,
  scoreWorkflow,
  setScoreWorkflow,
  totalPercent,
  totalScore,
  feedbackEntries,
  feedbackDraft,
  hasFreshAIDraft,
  setFeedbackDraft,
  onAIDraftAcknowledge,
  gradeError,
  autoGrading,
  feedbackReturning,
  gradeSaving,
  repoAnalyzing,
  expandedSections,
  onToggleSection,
  handleAutoGrade,
  handleReturnFeedback,
  handleSaveGrade,
  handleAnalyzeRepo,
}: {
  data: StudentWorkData
  historyEntries: AssignmentDocHistoryEntry[]
  historyLoading: boolean
  historyError: string
  previewEntry: AssignmentDocHistoryEntry | null
  onEntryClick: (entry: AssignmentDocHistoryEntry) => void
  onEntryHover: (entry: AssignmentDocHistoryEntry) => void
  onHistoryMouseLeave: () => void
  isPreviewLocked: boolean
  onExitPreview: () => void
  repoReviewResult: AssignmentRepoReviewResult | null
  scoreCompletion: string
  setScoreCompletion: (value: string) => void
  scoreThinking: string
  setScoreThinking: (value: string) => void
  scoreWorkflow: string
  setScoreWorkflow: (value: string) => void
  totalPercent: number
  totalScore: number
  feedbackEntries: AssignmentFeedbackEntry[]
  feedbackDraft: string
  hasFreshAIDraft: boolean
  setFeedbackDraft: (value: string) => void
  onAIDraftAcknowledge: () => void
  gradeError: string
  autoGrading: boolean
  feedbackReturning: boolean
  gradeSaving: boolean
  repoAnalyzing: boolean
  expandedSections: InspectorSectionId[]
  onToggleSection: (section: InspectorSectionId) => void
  handleAutoGrade: () => Promise<void>
  handleReturnFeedback: () => Promise<void>
  handleSaveGrade: (mode: GradeSaveMode) => Promise<void>
  handleAnalyzeRepo: () => Promise<void>
}) {
  const hasRepoConnection = !!(
    data.repo_target.effectiveRepoUrl || data.repo_target.effectiveGitHubUsername
  )

  const sections: Array<{
    id: InspectorSectionId
    title: string
    summary: ReactNode
    action?: ReactNode
    content: ReactNode
  }> = [
    {
      id: 'history',
      title: 'History',
      summary: (
        <AuthenticityGauge
          score={data.doc?.authenticity_score ?? null}
          flags={data.doc?.authenticity_flags ?? []}
        />
      ),
      content: (
        <Fragment>
          <div className="max-h-[18rem] overflow-y-auto" onMouseLeave={onHistoryMouseLeave}>
            {historyLoading && historyEntries.length === 0 ? (
              <div className="p-4 text-center">
                <Spinner size="sm" />
              </div>
            ) : historyError ? (
              <p className="text-xs text-danger">{historyError}</p>
            ) : historyEntries.length === 0 ? (
              <p className="text-xs text-text-muted">No saves yet</p>
            ) : (
              <HistoryList
                entries={historyEntries}
                activeEntryId={previewEntry?.id ?? null}
                onEntryClick={onEntryClick}
                onEntryHover={onEntryHover}
              />
            )}
          </div>
          {isPreviewLocked && previewEntry && (
            <div className="mt-3">
              <Button onClick={onExitPreview} variant="secondary" size="sm" className="w-full">
                Exit preview
              </Button>
            </div>
          )}
        </Fragment>
      ),
    },
    {
      id: 'repo',
      title: 'Repo',
      summary: (
        <RepoSummary
          repoReviewResult={repoReviewResult}
          hasRepoConnection={hasRepoConnection}
        />
      ),
      action: (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void handleAnalyzeRepo()
          }}
          disabled={
            repoAnalyzing ||
            !data.repo_target.effectiveRepoUrl ||
            !data.repo_target.effectiveGitHubUsername
          }
        >
          {repoAnalyzing ? 'Analyzing...' : 'Analyze Repo'}
        </Button>
      ),
      content: repoReviewResult ? (
        <div className="space-y-2">
          <RepoMetricBar
            label="Contribution"
            value={repoReviewResult.relative_contribution_share || 0}
          />
          <RepoMetricBar
            label="Consistency"
            value={repoReviewResult.spread_score || 0}
          />
          <RepoMetricBar
            label="Iteration"
            value={repoReviewResult.iteration_score || 0}
          />
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          {hasRepoConnection
            ? 'Run repo analysis to see contribution, consistency, and iteration details.'
            : 'No repository metadata is available for this submission yet.'}
        </p>
      ),
    },
    {
      id: 'grades',
      title: 'Grade',
      summary: <GradeSummary totalPercent={totalPercent} />,
      action: (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void handleAutoGrade()
            }}
            disabled={autoGrading}
          >
            {autoGrading ? 'Grading...' : 'AI grade'}
          </Button>
          <SplitButton
            label={gradeSaving ? 'Saving...' : 'Save'}
            onPrimaryClick={() => {
              void handleSaveGrade('graded')
            }}
            options={[
              {
                id: 'draft',
                label: 'Draft',
                onSelect: () => {
                  void handleSaveGrade('draft')
                },
              },
            ]}
            size="sm"
            disabled={gradeSaving}
            toggleAriaLabel="Choose save mode"
          />
        </div>
      ),
      content: (
        <div className="space-y-3">
          <ScoreInput label="Completion" value={scoreCompletion} onChange={setScoreCompletion} />
          <ScoreInput label="Thinking" value={scoreThinking} onChange={setScoreThinking} />
          <ScoreInput label="Workflow" value={scoreWorkflow} onChange={setScoreWorkflow} />
          <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_4.75rem] items-center gap-x-2">
            <div className="whitespace-nowrap text-[11px] font-medium text-text-muted">Total</div>
            <div />
            <ScoreTotalBox value={totalScore} total={30} />
          </div>
        </div>
      ),
    },
    {
      id: 'comments',
      title: 'Feedback',
      content: (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Feedback Draft
              </div>
              {hasFreshAIDraft && (
                <span className="rounded-full border border-primary/40 bg-info-bg px-2 py-0.5 text-[11px] font-medium text-primary">
                  AI draft
                </span>
              )}
            </div>
            <textarea
              value={feedbackDraft}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              onFocus={onAIDraftAcknowledge}
              className={[
                'min-h-[10rem] w-full resize-y rounded border px-2 py-1 text-sm text-text-default',
                hasFreshAIDraft ? 'border-primary bg-info-bg' : 'border-border bg-surface',
              ].join(' ')}
              placeholder="Teacher feedback draft"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void handleReturnFeedback()
                }}
                disabled={feedbackReturning || !feedbackDraft.trim()}
              >
                {feedbackReturning ? 'Returning...' : 'Return Feedback'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Returned Feedback
            </div>
            {feedbackEntries.length > 0 ? (
              <div className="rounded border border-border bg-surface p-3">
                <div className="space-y-3">
                  {feedbackEntries.map((entry) => (
                    <div key={entry.id}>
                      <div className="mb-1 text-[11px] font-medium text-text-muted">
                        {formatInTimeZone(
                          new Date(entry.returned_at),
                          'America/Toronto',
                          'MMM d, h:mm a',
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-sm text-text-default">
                        {entry.body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">No returned feedback yet.</p>
            )}
          </div>
        </div>
      ),
    },
  ]

  return (
    <div
      data-testid="grading-inspector-pane"
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex-1 overflow-y-auto">
        <div>
          {sections.map((section) => (
            <InspectorSection
              key={section.id}
              id={section.id}
              title={section.title}
              expanded={expandedSections.includes(section.id)}
              summary={section.summary}
              action={section.action}
              onToggle={() => onToggleSection(section.id)}
            >
              {section.content}
            </InspectorSection>
          ))}
        </div>
      </div>

      {(gradeError || data.doc?.graded_at) && (
        <div className="border-t border-border bg-surface px-3 py-3">
          <div className="space-y-3">
            {gradeError && (
              <div className="rounded border border-danger bg-danger-bg px-2 py-1.5 text-xs text-danger">
                {gradeError}
              </div>
            )}

            {data.doc?.graded_at && (
              <div className="text-xs text-text-muted">
                Graded{' '}
                {formatInTimeZone(
                  new Date(data.doc.graded_at),
                  'America/Toronto',
                  'MMM d, h:mm a',
                )}
                {data.doc.graded_by &&
                  ` by ${data.doc.graded_by.startsWith('ai:') ? 'AI' : data.doc.graded_by}`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
