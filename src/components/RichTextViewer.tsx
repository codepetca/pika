'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref } from '@/lib/tiptap-content'

interface RichTextViewerProps {
  content: TiptapContent
  showPlainText?: boolean
}

export function RichTextViewer({
  content,
  showPlainText = false,
}: RichTextViewerProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: true,
        validate: href => isSafeLinkHref(href),
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-700',
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
    ],
    content: content,
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert prose-sm max-w-none',
      },
    },
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
      <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-950 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
        {editor.getText()}
      </pre>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <EditorContent editor={editor} />
    </div>
  )
}
