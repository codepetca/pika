'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref, sanitizeLinkHref } from '@/lib/tiptap-content'

interface RichTextEditorProps {
  content: TiptapContent
  onChange: (content: TiptapContent) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  editable?: boolean
}

export function RichTextEditor({
  content,
  onChange,
  onBlur,
  placeholder = 'Write your response here...',
  disabled = false,
  editable = true,
}: RichTextEditorProps) {
  const canEdit = editable && !disabled
  const containerRef = useRef<HTMLDivElement | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        validate: href => isSafeLinkHref(href),
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-700',
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: content,
    editable: canEdit,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as TiptapContent)
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[300px] px-3 py-2',
      },
    },
  })

  useEffect(() => {
    if (editor && JSON.stringify(content) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit)
    }
  }, [canEdit, editor])

  if (!editor) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500"
      onBlurCapture={event => {
        if (!onBlur) return
        const relatedTarget = event.relatedTarget as Node | null
        if (relatedTarget && containerRef.current?.contains(relatedTarget)) return
        onBlur()
      }}
    >
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50">
        <div className="p-2 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('bold')}
            className={`px-2 py-1 rounded text-sm font-semibold ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('bold') ? 'bg-gray-300' : 'bg-white'}`}
          >
            B
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('italic')}
            className={`px-2 py-1 rounded text-sm italic ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('italic') ? 'bg-gray-300' : 'bg-white'}`}
          >
            I
          </button>
          <div className="w-px bg-gray-300 mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('heading', { level: 1 })}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-300' : 'bg-white'}`}
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('heading', { level: 2 })}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-300' : 'bg-white'}`}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('heading', { level: 3 })}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('heading', { level: 3 }) ? 'bg-gray-300' : 'bg-white'}`}
          >
            H3
          </button>
          <div className="w-px bg-gray-300 mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('bulletList')}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('bulletList') ? 'bg-gray-300' : 'bg-white'}`}
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('orderedList')}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('orderedList') ? 'bg-gray-300' : 'bg-white'}`}
          >
            1. List
          </button>
          <div className="w-px bg-gray-300 mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            disabled={!canEdit}
            aria-pressed={editor.isActive('codeBlock')}
            className={`px-2 py-1 rounded text-sm font-mono ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('codeBlock') ? 'bg-gray-300' : 'bg-white'}`}
          >
            {'</>'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canEdit) return
              const raw = window.prompt('Enter URL:')
              if (!raw) return
              const href = sanitizeLinkHref(raw)
              if (!href) {
                window.alert('Please enter a valid URL (http, https) or email address.')
                return
              }
              if (!isSafeLinkHref(href)) {
                window.alert('That link type is not allowed.')
                return
              }
              editor.chain().focus().setLink({ href }).run()
            }}
            disabled={!canEdit}
            aria-pressed={editor.isActive('link')}
            className={`px-2 py-1 rounded text-sm ${canEdit ? 'hover:bg-gray-200' : 'opacity-50 cursor-not-allowed'} ${editor.isActive('link') ? 'bg-gray-300' : 'bg-white'}`}
          >
            Link
          </button>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
