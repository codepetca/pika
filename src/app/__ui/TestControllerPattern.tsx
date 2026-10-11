'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TeacherTestAuthoringDialog } from '@/components/test-workspace/TeacherTestAuthoringDialog'
import type { AssessmentEditorSummaryUpdate, TestAssessmentWithStats } from '@/types'
import { Button, Card } from '@/ui'

// Explicit E2E mode only. Verification must intercept every API request before
// opening this real controller; the fixture supplies no persistence transport.
const FIXTURE_TEST: TestAssessmentWithStats = {
  id: 'test-controller-A', classroom_id: 'classroom-controller',
  title: 'Field observations', assessment_type: 'test', status: 'draft',
  opens_at: null, show_results: false, documents: [], position: 0,
  created_by: 'teacher-controller', created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  stats: { total_students: 25, responded: 0, questions_count: 2 },
}
const INITIAL_OWNER = {
  mounted: true, open: false, record: FIXTURE_TEST as TestAssessmentWithStats | null,
  classroomId: 'classroom-controller', apiBasePath: '/api/teacher/tests',
}

export function TestControllerPattern() {
  const sectionRef = useRef<HTMLElement>(null)
  const [owner, setOwner] = useState(INITIAL_OWNER)
  const [pendingMarkdown, setPendingMarkdown] = useState(false)
  const [receipt, setReceipt] = useState('Controlled controller fixture; API requests require browser interception.')

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const driveOwner = (event: Event) => {
      const command: unknown = (event as CustomEvent<unknown>).detail
      setOwner(current => {
        switch (command) {
          case 'close': return { ...current, open: false }
          case 'reopen': return { ...INITIAL_OWNER, open: true }
          case 'summary': return current.record ? { ...current, record: { ...current.record, title: 'Updated summary' } } : current
          case 'replace': return { ...current, record: { ...FIXTURE_TEST, id: 'test-controller-B', title: 'Another test' } }
          case 'classroom': return { ...current, classroomId: 'classroom-controller-B' }
          case 'api': return { ...current, apiBasePath: '/api/teacher/controller-tests' }
          case 'missing': return { ...current, open: false, record: null }
          case 'unmount': return { ...current, mounted: false, open: false }
          default: return current
        }
      })
    }
    section.addEventListener('test-fixture-owner', driveOwner)
    return () => section.removeEventListener('test-fixture-owner', driveOwner)
  }, [])

  const mergeSummary = useCallback((update: AssessmentEditorSummaryUpdate) => {
    setOwner(current => current.record ? {
      ...current, record: { ...current.record, title: update.title, show_results: update.show_results,
        stats: { ...current.record.stats, questions_count: update.questions_count } },
    } : current)
    setReceipt(`Summary: ${update.questions_count} questions; ${update.title}.`)
  }, [])

  return (
    <section id="test-controller" ref={sectionRef} data-testid="test-controller-fixture">
      <Card tone="panel" padding="md">
        <h3 className="font-semibold">Test controller fixture</h3>
        <Button variant="surface" className="mt-3" onClick={() => setOwner({ ...INITIAL_OWNER, open: true })}>
          Open controlled test
        </Button>
        <p role="status" className="mt-2 text-xs text-text-muted">{receipt}</p>
      </Card>
      {owner.mounted && <TeacherTestAuthoringDialog
        isOpen={owner.open} test={owner.record} classroomId={owner.classroomId} apiBasePath={owner.apiBasePath}
        hasPendingMarkdownImport={pendingMarkdown} onPendingMarkdownImportChange={setPendingMarkdown}
        onDraftSummaryChange={mergeSummary}
        onTestUpdate={update => { if (update) mergeSummary(update) }}
        onClose={() => {
          setOwner(current => ({ ...current, open: false }))
          setReceipt('Controller closed.')
        }}
        onRequestPublish={async () => { setReceipt('Publish callback acknowledged.'); return true }}
        onRequestPreview={preview => {
          setOwner(current => ({ ...current, open: false }))
          setReceipt(`Preview callback: ${preview.testId}; ${preview.title}.`)
        }}
      />}
    </section>
  )
}
