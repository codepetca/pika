import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistoryPreviewMinimap } from '@/components/editor/HistoryPreviewMinimap'
import type { AssignmentHistoryChange } from '@/lib/assignment-doc-history'
import type { HistoryPreviewMinimapState } from '@/hooks/useHistoryPreviewViewport'

describe('HistoryPreviewMinimap', () => {
  it('keeps its duplicate overview hidden from assistive technology while showing change and viewport markers', () => {
    const change: AssignmentHistoryChange = {
      changedBlocks: [{ index: 1, kind: 'modified' }],
      deletionAnchors: [{ index: 2, position: 'before', count: 1 }],
    }
    const state: HistoryPreviewMinimapState = {
      viewportTop: 0.4,
      viewportHeight: 0.2,
      markers: [
        { top: 0.45, height: 0.04, kind: 'modified' },
        { top: 0.7, height: 0.012, kind: 'deleted' },
      ],
    }

    const { container } = render(
      <HistoryPreviewMinimap
        content={{
          type: 'doc',
          content: [
            { type: 'heading', content: [{ type: 'text', text: 'Reflection' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Revised evidence' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Next observation' }] },
          ],
        }}
        change={change}
        state={state}
      />,
    )

    const minimap = container.querySelector('.history-preview-minimap')
    expect(minimap).toHaveAttribute('aria-hidden', 'true')
    expect(minimap?.querySelectorAll('.history-preview-minimap__block')).toHaveLength(3)
    expect(minimap?.querySelector('[data-change-kind="modified"]')).toBeInTheDocument()
    expect(minimap?.querySelector('[data-change-kind="deleted"]')).toBeInTheDocument()
    expect(minimap?.querySelector('.history-preview-minimap__viewport')).toHaveStyle({
      top: '40%',
      height: '20%',
    })
  })
})
