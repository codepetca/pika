'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { useEffect } from 'react'
import type { TiptapContent } from '@/types'

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
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-700',
        },
      }),
    ],
    content: content,
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none',
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
      <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 bg-gray-50 p-4 rounded-lg border border-gray-200">
        {editor.getText()}
      </pre>
    )
  }

  return (
    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
      <EditorContent editor={editor} />
    </div>
  )
}
