import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherBlueprintTab } from '@/app/classrooms/[classroomId]/TeacherBlueprintTab'
import { fetchCachedJSON } from '@/lib/request-cache'
import type { Classroom } from '@/types'

vi.mock('@/lib/request-cache', () => ({ fetchCachedJSON: vi.fn() }))
vi.mock('@/components/editor', () => ({
  RichTextViewer: ({ content }: { content: unknown }) => <div data-testid="markdown-content">{JSON.stringify(content)}</div>,
}))

const classroom = { id: 'classroom-1', title: 'ICS3U' } as Classroom

const linkedContext = {
  content_version_id: 'version-1',
  content_version_number: 3,
  source_blueprint_version_id: 'version-1',
  source_blueprint_version_number: 3,
  source_draft_revision: 9,
  course: {
    title: 'Computer Science 11', subject: 'Computer Science', grade_level: '11',
    outline_markdown: '# Programming fundamentals',
    assignment_titles: ['Build a Karel program'], test_titles: ['Unit 1 test'],
  },
  guidance: {
    course_expectations_markdown: 'Explain your reasoning.',
    assignment_guidance_markdown: 'Use concise instructions.',
    test_guidance_markdown: 'Put general instructions in a reference.',
    unit_exceptions: [{
      id: 'unit-1', unit_label: 'Unit 1',
      assignment_guidance_markdown: 'Use Karel.',
      test_guidance_markdown: 'Show code as Markdown.',
    }],
  },
}

describe('TeacherBlueprintTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the linked classroom Version in the content pane with teacher-only guidance', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValue({ context: linkedContext })
    const onSectionChange = vi.fn()
    const { rerender } = render(<TeacherBlueprintTab classroom={classroom} isActive onSectionChange={onSectionChange} />)

    expect(await screen.findByText('Content Version 3')).toBeInTheDocument()
    expect(screen.getAllByText('Computer Science 11')).toHaveLength(2)
    expect(screen.getByText(/Guidance changes only when you review and update it/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Blueprint section' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Content' }))
    expect(onSectionChange).toHaveBeenCalledWith('content')
    rerender(<TeacherBlueprintTab classroom={classroom} isActive sectionParam="content" onSectionChange={onSectionChange} />)
    expect(screen.getByText('Build a Karel program')).toBeInTheDocument()
    expect(screen.getByText('Unit 1 test')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Authoring Guidance' }))
    expect(onSectionChange).toHaveBeenCalledWith('guidance')
    rerender(<TeacherBlueprintTab classroom={classroom} isActive sectionParam="guidance" onSectionChange={onSectionChange} />)
    expect(screen.getByText('Teacher only · Future drafts use these saved rules.')).toBeInTheDocument()
    expect(screen.getByText('Unit 1')).toBeInTheDocument()
    expect(screen.getAllByTestId('markdown-content')).toHaveLength(5)
  })

  it('distinguishes an unlinked classroom from a failed read', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValue({ context: null })
    const { unmount } = render(<TeacherBlueprintTab classroom={classroom} isActive />)

    expect(await screen.findByText('No Blueprint Version linked')).toBeInTheDocument()
    expect(screen.queryByText('Could not load Blueprint')).toBeNull()
    unmount()

    vi.mocked(fetchCachedJSON).mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ context: linkedContext })
    render(<TeacherBlueprintTab classroom={classroom} isActive />)
    expect(await screen.findByText('Could not load Blueprint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('Content Version 3')).toBeInTheDocument())
  })
  it('previews rules then submits only the reviewed revision and version guards', async () => {
    const proposed = { ...linkedContext.guidance, test_guidance_markdown: 'Updated test rules' }
    const preview = { blueprint_id: 'blueprint', expected_content_version_id: 'version-1',
      expected_guidance_version_id: 'version-1', expected_draft_revision: 10,
      current_guidance: linkedContext.guidance, guidance: proposed, changed: true }
    vi.mocked(fetchCachedJSON).mockResolvedValueOnce({ context: linkedContext })
      .mockResolvedValueOnce({ preview }).mockResolvedValueOnce({ context: {
        ...linkedContext, source_blueprint_version_number: 4, guidance: proposed,
      } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 4 }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TeacherBlueprintTab classroom={classroom} isActive sectionParam="guidance" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review guidance update' }))
    expect(await screen.findByRole('dialog', { name: 'Update authoring guidance' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Update guidance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      blueprint_id: 'blueprint', expected_content_version_id: 'version-1',
      expected_guidance_version_id: 'version-1', expected_draft_revision: 10,
    })
    expect(await screen.findByText('Guidance Version 4')).toBeInTheDocument()
    expect(screen.getByText('Content Version 3')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('does not offer adoption when content changed but rules are the same', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValueOnce({ context: linkedContext }).mockResolvedValueOnce({ preview: {
      blueprint_id: 'blueprint', expected_content_version_id: 'version-1', expected_guidance_version_id: 'version-1',
      expected_draft_revision: 10, current_guidance: linkedContext.guidance, guidance: linkedContext.guidance, changed: false,
    } })
    render(<TeacherBlueprintTab classroom={classroom} isActive sectionParam="guidance" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review guidance update' }))
    expect(await screen.findByText('The latest Blueprint Draft has the same guidance.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update guidance' })).toBeDisabled()
  })

  it('keeps the reviewed rules visible when a stale update is rejected', async () => {
    vi.mocked(fetchCachedJSON).mockResolvedValueOnce({ context: linkedContext }).mockResolvedValueOnce({ preview: {
      blueprint_id: 'blueprint', expected_content_version_id: 'version-1', expected_guidance_version_id: 'version-1',
      expected_draft_revision: 10, current_guidance: linkedContext.guidance,
      guidance: { ...linkedContext.guidance, test_guidance_markdown: 'New rules' }, changed: true,
    } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Blueprint Draft changed; review the latest guidance' }) }))
    render(<TeacherBlueprintTab classroom={classroom} isActive sectionParam="guidance" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review guidance update' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update guidance' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Blueprint Draft changed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Guidance Version 4')).toBeNull()
    vi.unstubAllGlobals()
  })

})
