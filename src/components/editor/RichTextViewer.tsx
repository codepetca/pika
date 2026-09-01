'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref } from '@/lib/tiptap-content'
import {
  useHistoryPreviewViewport,
  type HistoryPreviewMode,
} from '@/hooks/useHistoryPreviewViewport'
import type { AssignmentHistoryChange } from '@/lib/assignment-doc-history'
import {
  HistoryPreviewChangeSummary,
  HistoryPreviewMinimap,
} from './HistoryPreviewMinimap'

// --- Tiptap Core Extensions ---
import { StarterKit } from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { ManagedImage } from '@/components/tiptap-node/managed-image-node'

// --- Tiptap Node Styles ---
import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/list-node/list-node.scss'
import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'
import '@/components/tiptap-node/image-node/image-node.scss'

// --- Styles ---
import '@/components/tiptap-templates/simple/simple-editor.scss'

export interface RichTextViewerProps {
  content: TiptapContent
  showPlainText?: boolean
  fillHeight?: boolean
  chrome?: 'default' | 'flush'
  /** Controls whole-document framing while inspecting assignment history. */
  historyPreviewMode?: HistoryPreviewMode
  /** Changed blocks and deletion anchors for the active history save. */
  historyPreviewChange?: AssignmentHistoryChange | null
}

export function RichTextViewer({
  content,
  showPlainText = false,
  fillHeight = false,
  chrome = 'default',
  historyPreviewMode = 'current',
  historyPreviewChange = null,
}: RichTextViewerProps) {
  const { viewportRef, minimapState } = useHistoryPreviewViewport(
    historyPreviewMode,
    content,
    historyPreviewChange,
  )
  const showHistoryMinimap = (
    historyPreviewMode === 'focused' || historyPreviewMode === 'locked'
  ) && historyPreviewChange
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    editorProps: {
      attributes: {
        class: 'simple-editor',
      },
    },
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: true,
          validate: (href) => isSafeLinkHref(href),
          HTMLAttributes: {
            class:
              'text-primary underline hover:text-primary-hover cursor-pointer',
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        },
        // Code blocks intentionally use dark styling regardless of theme (industry standard)
        codeBlock: {
          HTMLAttributes: {
            class:
              'bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm',
          },
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Superscript,
      Subscript,
      ManagedImage.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded',
        },
      }),
    ],
    content,
  })

  useEffect(() => {
    if (editor && JSON.stringify(content) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  if (!editor) {
    return null
  }

  if (showPlainText) {
    return (
      <>
        {showHistoryMinimap ? (
          <HistoryPreviewChangeSummary change={historyPreviewChange} />
        ) : null}
        <pre
          className={[
            'whitespace-pre-wrap font-mono text-sm text-text-default bg-page p-4 rounded-none border border-border',
            fillHeight ? 'h-full overflow-y-auto' : 'overflow-x-auto',
          ].join(' ')}
        >
          {editor.getText()}
        </pre>
      </>
    )
  }

  return (
    <div
      className={[
        fillHeight ? 'simple-editor-wrapper simple-editor-wrapper--fill-height' : 'simple-viewer-wrapper',
        chrome === 'flush'
          ? 'bg-transparent border-transparent rounded-none'
          : 'bg-surface-2 rounded-none border border-border',
      ].join(' ')}
    >
      {showHistoryMinimap ? (
        <HistoryPreviewChangeSummary change={historyPreviewChange} />
      ) : null}
      <div className="history-preview-layout">
        <EditorContent
          ref={viewportRef}
          editor={editor}
          className={fillHeight ? 'simple-editor-content' : 'simple-viewer-content'}
          data-history-preview-mode={historyPreviewMode}
        />
        {showHistoryMinimap ? (
          <HistoryPreviewMinimap
            content={content}
            change={historyPreviewChange}
            state={minimapState}
          />
        ) : null}
      </div>
    </div>
  )
}
