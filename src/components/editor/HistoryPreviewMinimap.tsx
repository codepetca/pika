'use client'

import type { AssignmentHistoryChange } from '@/lib/assignment-doc-history'
import type { HistoryPreviewMinimapState } from '@/hooks/useHistoryPreviewViewport'
import type { TiptapContent, TiptapNode } from '@/types'

interface HistoryPreviewMinimapProps {
  content: TiptapContent
  change: AssignmentHistoryChange
  state: HistoryPreviewMinimapState | null
}

function getNodeText(node: TiptapNode): string {
  if (node.text) return node.text
  return node.content?.map(getNodeText).join(' ') ?? ''
}

function getLineWidth(text: string, lineIndex: number) {
  if (!text) return lineIndex === 0 ? 36 : 24
  const seed = text.charCodeAt(Math.min(text.length - 1, lineIndex * 7)) || 0
  return 38 + ((text.length + seed + lineIndex * 13) % 55)
}

export function HistoryPreviewMinimap({
  content,
  change,
  state,
}: HistoryPreviewMinimapProps) {
  const blocks = content.content ?? []
  const changedKinds = new Map(change.changedBlocks.map(({ index, kind }) => [index, kind]))

  return (
    <div className="history-preview-minimap" aria-hidden="true">
      <div className="history-preview-minimap__document">
        {blocks.map((block, blockIndex) => {
          const text = getNodeText(block)
          const lineCount = Math.max(1, Math.min(4, Math.ceil(Math.max(1, text.length) / 48)))
          const kind = changedKinds.get(blockIndex)
          return (
            <div
              key={`${block.type}-${blockIndex}`}
              className="history-preview-minimap__block"
              data-change-kind={kind}
            >
              {Array.from({ length: lineCount }, (_, lineIndex) => (
                <span
                  key={lineIndex}
                  className="history-preview-minimap__line"
                  style={{ width: `${getLineWidth(text, lineIndex)}%` }}
                />
              ))}
            </div>
          )
        })}
      </div>
      {state?.markers.map((marker, index) => (
        <span
          key={`${marker.kind}-${index}`}
          className="history-preview-minimap__change"
          data-change-kind={marker.kind}
          style={{
            top: `${marker.top * 100}%`,
            height: `${marker.height * 100}%`,
          }}
        />
      ))}
      {state ? (
        <span
          className="history-preview-minimap__viewport"
          style={{
            top: `${Math.min(state.viewportTop, 1 - state.viewportHeight) * 100}%`,
            height: `${Math.min(1, state.viewportHeight) * 100}%`,
          }}
        />
      ) : null}
    </div>
  )
}
