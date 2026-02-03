'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref } from '@/lib/tiptap-content'

// --- Tiptap Core Extensions ---
import { StarterKit } from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Underline } from '@tiptap/extension-underline'
import { Image } from '@tiptap/extension-image'

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
}

export function RichTextViewer({ content, showPlainText = false }: RichTextViewerProps) {
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
      Underline,
      Image.configure({
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
      <pre className="whitespace-pre-wrap font-mono text-sm text-text-default bg-page p-4 rounded-none border border-border h-full overflow-y-auto">
        {editor.getText()}
      </pre>
    )
  }

  return (
    <div className="simple-editor-wrapper bg-surface-2 p-4 rounded-none border border-border flex flex-col min-h-0 h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
