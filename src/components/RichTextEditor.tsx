'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'
import type { TiptapContent } from '@/types'

interface RichTextEditorProps {
  content: TiptapContent
  onChange: (content: TiptapContent) => void
  placeholder?: string
  disabled?: boolean
  editable?: boolean
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Write your response here...',
  disabled = false,
  editable = true,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline hover:text-blue-700',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: content,
    editable: editable && !disabled,
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
      editor.setEditable(editable && !disabled)
    }
  }, [editable, disabled, editor])

  if (!editor) {
    return null
  }

  return (
    <div className="border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500">
      {editable && !disabled && (
        <div className="border-b border-gray-200 p-2 flex flex-wrap gap-1 bg-gray-50">
          <button onClick={() => editor.chain().focus().toggleBold().run()} className={`px-2 py-1 rounded text-sm font-semibold hover:bg-gray-200 ${editor.isActive('bold') ? 'bg-gray-300' : 'bg-white'}`} type="button">B</button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`px-2 py-1 rounded text-sm italic hover:bg-gray-200 ${editor.isActive('italic') ? 'bg-gray-300' : 'bg-white'}`} type="button">I</button>
          <div className="w-px bg-gray-300 mx-1" />
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('heading', { level: 1 }) ? 'bg-gray-300' : 'bg-white'}`} type="button">H1</button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('heading', { level: 2 }) ? 'bg-gray-300' : 'bg-white'}`} type="button">H2</button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('heading', { level: 3 }) ? 'bg-gray-300' : 'bg-white'}`} type="button">H3</button>
          <div className="w-px bg-gray-300 mx-1" />
          <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('bulletList') ? 'bg-gray-300' : 'bg-white'}`} type="button">• List</button>
          <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('orderedList') ? 'bg-gray-300' : 'bg-white'}`} type="button">1. List</button>
          <div className="w-px bg-gray-300 mx-1" />
          <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={`px-2 py-1 rounded text-sm font-mono hover:bg-gray-200 ${editor.isActive('codeBlock') ? 'bg-gray-300' : 'bg-white'}`} type="button">{'<\/>'}</button>
          <button onClick={() => { const url = window.prompt('Enter URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }} className={`px-2 py-1 rounded text-sm hover:bg-gray-200 ${editor.isActive('link') ? 'bg-gray-300' : 'bg-white'}`} type="button">Link</button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
