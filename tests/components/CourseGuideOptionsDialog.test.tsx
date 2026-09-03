import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CourseGuideOptionsDialog } from '@/components/CourseGuideOptionsDialog'
import { DEFAULT_ACTUAL_COURSE_SITE_CONFIG } from '@/lib/course-site-publishing'

describe('CourseGuideOptionsDialog', () => {
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
