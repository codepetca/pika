'use client'

import { useEffect, useRef, useState } from 'react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { TeacherSurveyWorkspace } from '@/components/surveys/TeacherSurveyWorkspace'
import type { Survey, SurveyQuestion } from '@/types'
import { Button, Card } from '@/ui'

// The same explicit E2E flag as TestControllerPattern exposes this production
// owner. Verification intercepts every API request before opening either editor;
// this fixture supplies fixed records, not an alternate persistence transport.
export const SURVEY_CONTROLLER_FIXTURE: Survey = {
  id: 'survey-controller-A', classroom_id: 'classroom-controller',
  title: 'Wetland field study feedback', status: 'draft', opens_at: null,
  show_results: false, dynamic_responses: false, position: 0,
  created_by: 'teacher-controller', created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
}

export const SURVEY_CONTROLLER_QUESTIONS: SurveyQuestion[] = [
  {
    id: 'survey-controller-question-1', survey_id: SURVEY_CONTROLLER_FIXTURE.id,
    question_type: 'multiple_choice', question_text: 'Which activity helped you understand the wetland ecosystem best?',
    options: ['The field observations', 'The group discussion', 'The species research'],
    response_max_chars: 500, position: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'survey-controller-question-2', survey_id: SURVEY_CONTROLLER_FIXTURE.id,
    question_type: 'short_text', question_text: 'What is one question you would like to explore next?',
    options: [], response_max_chars: 500, position: 1,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  },
]

const INITIAL_OWNER = {
  mounted: true, open: false, surveyId: SURVEY_CONTROLLER_FIXTURE.id,
  classroomId: SURVEY_CONTROLLER_FIXTURE.classroom_id,
}

/** Actual survey workspace and production modal composition, with intercepted fixture data. */
export function SurveyControllerPattern() {
  const sectionRef = useRef<HTMLElement>(null)
  const closeRef = useRef<(() => Promise<void>) | null>(null)
  const [owner, setOwner] = useState(INITIAL_OWNER)
  const [closeDisabled, setCloseDisabled] = useState(false)
  const [receipt, setReceipt] = useState('Controlled production survey editor; intercept all API requests before opening.')

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const driveOwner = (event: Event) => {
      const command: unknown = (event as CustomEvent<unknown>).detail
      setOwner(current => {
        switch (command) {
          case 'close': return { ...current, open: false }
          case 'reopen': return { ...INITIAL_OWNER, open: true }
          case 'replace': return { ...current, surveyId: 'survey-controller-B' }
          case 'classroom': return { ...current, classroomId: 'classroom-controller-B' }
          case 'unmount': return { ...current, mounted: false, open: false }
          default: return current
        }
      })
    }
    section.addEventListener('survey-fixture-owner', driveOwner)
    return () => section.removeEventListener('survey-fixture-owner', driveOwner)
  }, [])

  function closeOwner() {
    setOwner(current => ({ ...current, open: false }))
    setReceipt('Survey controller closed.')
  }

  return (
    <section id="survey-controller" ref={sectionRef} data-testid="survey-controller-fixture">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Survey controller fixture</h3>
        <Button variant="surface" className="mt-3" onClick={() => {
          setCloseDisabled(false)
          setOwner({ ...INITIAL_OWNER, open: true })
        }}>
          Open controlled survey
        </Button>
        <p role="status" className="mt-2 text-xs text-text-muted">{receipt}</p>
      </Card>
      {owner.mounted && <CreationModalShell
        isOpen={owner.open}
        onClose={() => { void closeRef.current?.() }}
        title="Edit survey"
        titleId="survey-controller-dialog-title"
        closeLabel="Close survey editor"
        closeDisabled={closeDisabled}
        maxWidth="!max-w-6xl"
        panelClassName="!p-0"
        contentClassName="!overflow-hidden !p-0"
        tall
      >
        {owner.open && <TeacherSurveyWorkspace
          key={owner.surveyId}
          classroomId={owner.classroomId}
          classroomName="Biology 11 — Ecosystems and field studies — Classroom context fades at the pane edge"
          surveyId={owner.surveyId}
          showCloseButton={false}
          onCloseReady={close => { closeRef.current = close }}
          onCloseDisabledChange={setCloseDisabled}
          onBack={closeOwner}
          onSurveyUpdated={survey => setReceipt(`Survey update: ${survey.title}; ${survey.status}.`)}
          onQuestionCountChanged={(_surveyId, count) => setReceipt(`Survey has ${count} questions.`)}
          onSurveyDeleted={surveyId => setReceipt(`Survey deletion acknowledged: ${surveyId}.`)}
        />}
      </CreationModalShell>}
    </section>
  )
}
