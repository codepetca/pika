import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnnouncementContent } from '@/components/AnnouncementContent'

describe('AnnouncementContent', () => {
  it('renders supported markdown in announcement content', () => {
    render(
      <AnnouncementContent content={'## Update\nRead the [course outline](https://example.com/outline) and **bring notes**.'} />
    )

    expect(screen.getByRole('heading', { name: 'Update' })).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'course outline' })).toHaveAttribute(
      'href',
      'https://example.com/outline',
    )
  })

  it('does not render unsafe markdown links as anchors', () => {
    render(<AnnouncementContent content={'Open [unsafe](javascript:alert(1))'} />)

    expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument()
    expect(
      screen.getByText((_, node) => node?.tagName === 'P' && node.textContent === 'Open unsafe)')
    ).toBeInTheDocument()
  })
})
