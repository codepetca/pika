import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { useTeacherTestList } from '@/hooks/useTeacherTestList'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { createMockClassroom, createMockTest } from '../helpers/mocks'

afterEach(() => {
  invalidateCachedJSONMatching('')
  vi.unstubAllGlobals()
})

describe('mounted Tests list and Gradebook title saves', () => {
  it.each([
    { detailsFail: false, retainedEditor: false }, { detailsFail: true, retainedEditor: false },
    { detailsFail: false, retainedEditor: true }, { detailsFail: true, retainedEditor: true },
  ])('refreshes on return after a Test rename ($detailsFail / retained editor: $retainedEditor)', async ({ detailsFail, retainedEditor }) => {
    const classroom = createMockClassroom()
    const test = createMockTest({ id: 'test-1', title: 'Original Test', assessment_type: 'test' })
    let title = test.title
    const ok = (data: unknown) => ({ ok: true, json: async () => data })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/teacher/tests/test-1/draft') {
        if (init?.method === 'PATCH') title = JSON.parse(String(init.body)).patch[0].value
        return ok({ draft: { version: 1 } })
      }
      if (url.startsWith('/api/teacher/tests?')) return ok({ tests: [{ ...test, title }] })
      if (url.includes('/roster')) return ok({ roster: [] })
      if (init?.method === 'PATCH') return detailsFail
        ? { ok: false, json: async () => ({ error: 'Weight service unavailable' }) }
        : ok({})
      return ok({ categories: [], students: [], assessment_columns: [{ assessment_id: test.id, assessment_type: 'test', title, code: 'T1', possible: 10, weight: 10, include_in_final: true }] })
    }))

    function MountedTabs() {
      const [tab, setTab] = useState('tests')
      const list = useTeacherTestList({ classroomId: classroom.id, selectedTestId: retainedEditor ? test.id : null, selectedTestDraftSummary: retainedEditor ? { title: test.title, show_results: false, questions_count: 3 } : null })
      return <AppMessageProvider><TooltipProvider>
        <button onClick={() => setTab('tests')}>Tests tab</button>
        <button onClick={() => setTab('gradebook')}>Gradebook tab</button>
        <section aria-label="Tests list" hidden={tab !== 'tests'}>{list.visibleTests.map((item) => <p key={item.id}>{item.title}</p>)}</section>
        <div hidden={tab !== 'gradebook'}><TeacherGradebookTab classroom={classroom} isActive={tab === 'gradebook'} /></div>
      </TooltipProvider></AppMessageProvider>
    }

    render(<MountedTabs />)
    const list = screen.getByRole('region', { name: 'Tests list' })
    await within(list).findByText('Original Test')
    fireEvent.click(screen.getByRole('button', { name: 'Gradebook tab' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit T1: Original Test' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Assessment title' }), { target: { value: 'Renamed from Gradebook' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save assessment' }))
    if (detailsFail) {
      await screen.findByText(/Title saved, but category and weight could not be confirmed/)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    fireEvent.click(screen.getByRole('button', { name: 'Tests tab' }))
    await within(list).findByText('Renamed from Gradebook')
    expect(within(list).queryByText('Original Test')).not.toBeInTheDocument()
  })
})
