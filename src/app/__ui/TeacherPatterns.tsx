'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { DateNavigator } from '@/components/DateNavigator'
import { TeacherWorkSurfaceContextBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceContextBar'
import { TeacherWorkSurfaceModeBar } from '@/components/teacher-work-surface/TeacherWorkSurfaceModeBar'
import { TeacherWorkSurfaceShell } from '@/components/teacher-work-surface/TeacherWorkSurfaceShell'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'
import { Button, Card, TabPanel } from '@/ui'

// Fixed calendar context keeps examples reproducible without browser preferences or APIs.
const REFERENCE_TODAY = '2026-08-30'
type PreviewMode = 'overview' | 'details'

export function TeacherPatterns() {
  const [date, setDate] = useState('2026-08-28')
  const [showRelativeDate, setShowRelativeDate] = useState(true)
  const [mode, setMode] = useState<PreviewMode>('overview')

  return (
    <div className="space-y-5" data-testid="teacher-pattern-examples">
      <Card tone="panel" padding="md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold">Daily date context (page-specific)</h3>
            <p className="mt-1 text-sm text-text-muted">
              Relative-date text is Daily-only. The date control and action-bar spacing are shared.
            </p>
          </div>
          <Button
            size="sm"
            variant={showRelativeDate ? 'secondary' : 'surface'}
            aria-pressed={showRelativeDate}
            onClick={() => setShowRelativeDate((visible) => !visible)}
          >
            Relative date
          </Button>
        </div>
        <div className="mt-4 rounded-card border border-border bg-page pb-3" data-testid="standalone-shell-example">
          <TeacherWorkSurfaceShell
            className="mx-0"
            state="workspace"
            workspaceFrame="standalone"
            primary={
              <TeacherWorkSurfaceContextBar
                ariaLabel="Example date controls"
                primary={
                  <DateNavigator
                    joined
                    label={format(parseISO(date), 'EEE MMM d')}
                    subtitle={showRelativeDate ? getPastRelativeDateLabel(date, REFERENCE_TODAY) : null}
                    onPrev={() => setDate((current) => addDaysToDateString(current, -1))}
                    onNext={() => setDate((current) => addDaysToDateString(current, 1))}
                    onLabelClick={() => setDate(REFERENCE_TODAY)}
                    labelAriaLabel="Go to reference today"
                    prevAriaLabel="Previous example day"
                    nextAriaLabel="Next example day"
                    labelClassName="min-w-24 px-2 sm:min-w-28 sm:px-3"
                  />
                }
              />
            }
            summary={null}
            workspace={
              <div className="p-4 text-sm">
                <p className="font-medium">Date-scoped work region</p>
                <p className="mt-1 text-text-muted">Feature-owned content sits beneath the shared controls.</p>
              </div>
            }
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-text-muted">
          Fixture today: Sun Aug 30, 2026. Use the arrows for past/today/future states; click the date to
          reset to today. Future dates have no subtitle. Do not add relative-date text to other pages.
          This Lab toggle is temporary; Daily owns its
          saved Show/Hide relative date preference and its date picker.
        </p>
      </Card>

      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Attached workspace tabs</h3>
        <p className="mt-1 text-sm text-text-muted">
          Selected-workspace reference · tabs connect directly to their panel, without standalone top spacing.
        </p>
        <div className="mt-4 rounded-card border border-border bg-page" data-testid="attached-shell-example">
          <TeacherWorkSurfaceShell
            className="mx-0"
            state="workspace"
            workspaceFrame="attachedTabs"
            primary={
              <TeacherWorkSurfaceModeBar<PreviewMode>
                ariaLabel="Example workspace modes"
                modes={[{ id: 'overview', label: 'Overview' }, { id: 'details', label: 'Work details' }]}
                activeMode={mode}
                onModeChange={setMode}
                getTabId={(value) => `teacher-example-${value}-tab`}
                getPanelId={(value) => `teacher-example-${value}-panel`}
              />
            }
            summary={null}
            workspace={
              <>
                <div hidden={mode !== 'overview'}>
                  <TabPanel id="teacher-example-overview-panel" labelledBy="teacher-example-overview-tab" className="p-4 text-sm" focusable>
                    Overview of the selected work item.
                  </TabPanel>
                </div>
                <div hidden={mode !== 'details'}>
                  <TabPanel id="teacher-example-details-panel" labelledBy="teacher-example-details-tab" className="p-4 text-sm" focusable>
                    Details for the same selected work item.
                  </TabPanel>
                </div>
              </>
            }
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-text-muted">
          Only use modes after an item is selected and when they represent different work. Keep both
          panel targets mounted; the shared mode bar owns arrow-key navigation and selection.
        </p>
      </Card>

      <Card tone="muted" padding="sm">
        <h3 className="text-sm font-semibold">What stays local</h3>
        <p className="mt-1 text-sm text-text-muted">
          Daily&apos;s stronger table header, saved display preference, attendance commands, and status
          meanings remain feature-owned. Reuse the existing date, context-bar, and shell components;
          do not turn this fixture into a new page template or a universal status system.
        </p>
      </Card>
    </div>
  )
}
