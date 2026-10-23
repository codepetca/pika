import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LimitedMarkdown } from '@/components/LimitedMarkdown'

describe('LimitedMarkdown image reading', () => {
  it('renders protected and remote images as images, including adjacent prose and a description', () => {
    render(<LimitedMarkdown content={'Before ![Wetland](/api/teacher/images/photo.png) after.\n\n![A \\[label\\]](https://example.com/chart.png)'} />)
    expect(screen.getByRole('img', { name: 'Wetland' })).toHaveAttribute('src', '/api/teacher/images/photo.png')
    expect(screen.getByRole('img', { name: 'A [label]' })).toHaveAttribute('src', 'https://example.com/chart.png')
    expect(screen.getByText(/Before/)).toHaveTextContent('Before after.')
  })
  it('does not render unsafe image sources or image syntax inside code', () => {
    const view = render(<LimitedMarkdown content={'![Description](javascript:evil)\n\n`![Code](https://example.com/code.png)`'} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(view.container).toHaveTextContent('Description')
    expect(view.container.querySelector('code')).toHaveTextContent('![Code](https://example.com/code.png)')
  })
})
