import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { CourseGuideOptionsDialog } from '@/components/CourseGuideOptionsDialog'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'

describe('CourseGuideOptionsDialog', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('forwards the parent exit policy and removes a retained draft immediately when authority ends', () => {
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computedStyle(element)
      style.setProperty('--motion-duration-standard', '200ms')
      return style
    })
    const props = {
      saving: false, error: 'Outgoing error', published: true, slug: 'private-draft',
      config: DEFAULT_ACTUAL_COURSE_SITE_CONFIG,
      onPublishedChange: vi.fn(), onSlugChange: vi.fn(), onConfigChange: vi.fn(),
      onGenerateSlug: vi.fn(), onOpenPublicGuide: vi.fn(), onImportCurriculum: vi.fn(),
      onSave: vi.fn(), onClose: vi.fn(),
    }
    const view = render(<CourseGuideOptionsDialog {...props} isOpen exitMotion="opacity" />)
    const dialog = screen.getByRole('dialog', { name: 'Guide options' })
    view.rerender(<CourseGuideOptionsDialog {...props} isOpen={false} exitMotion="opacity" slug="" error="" />)
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Outgoing error')).toBeInTheDocument()
    expect(screen.getByLabelText('Public page address')).toHaveValue('private-draft')
    view.rerender(<CourseGuideOptionsDialog {...props} isOpen={false} exitMotion="none" slug="" error="" />)
    expect(dialog).not.toBeInTheDocument()
    expect(screen.queryByText('Outgoing error')).toBeNull()
  })
  it('exposes the curriculum import action and semantic visibility toggles', () => {
    const onImportCurriculum = vi.fn()
    const onConfigChange = vi.fn()
    render(
      <CourseGuideOptionsDialog
        isOpen
        saving={false}
        error=""
        published={false}
        slug=""
        config={DEFAULT_ACTUAL_COURSE_SITE_CONFIG}
        onPublishedChange={vi.fn()}
        onSlugChange={vi.fn()}
        onConfigChange={onConfigChange}
        onGenerateSlug={vi.fn()}
        onOpenPublicGuide={vi.fn()}
        onImportCurriculum={onImportCurriculum}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const importButton = screen.getByRole('button', { name: 'Import curriculum' })
    fireEvent.click(importButton)
    expect(onImportCurriculum).toHaveBeenCalledOnce()

    const overviewToggle = screen.getByRole('button', { name: 'Hide Course guide' })
    expect(overviewToggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(overviewToggle)
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ overview: false }))
    expect(screen.getByText(/high-level course orientation/i)).toBeInTheDocument()
    expect(screen.getByText(/compact title lists/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resources/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Lesson sequence/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Announcements/ })).toBeNull()
    expect(screen.queryByLabelText('Lesson sequence range')).toBeNull()
  })
})
