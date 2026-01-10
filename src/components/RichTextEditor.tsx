'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TextStyle from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Underline from '@tiptap/extension-underline'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref, sanitizeLinkHref } from '@/lib/tiptap-content'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code,
  Link as LinkIcon,
  RemoveFormatting,
} from 'lucide-react'

interface RichTextEditorProps {
  content: TiptapContent
  onChange: (content: TiptapContent) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  editable?: boolean
  className?: string
}

interface IconButtonProps {
  onClick: () => void
  disabled: boolean
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
}

function IconButton({ onClick, disabled, active, icon: Icon, label, shortcut }: IconButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={title}
      className={`p-2 rounded text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-200 dark:hover:bg-gray-600'} ${active ? 'bg-gray-300 dark:bg-gray-600 text-gray-900 dark:text-white' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200'}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

function FontFamilyDropdown({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false)

  const fonts = [
    { label: 'Default', value: '' },
    { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
    { label: 'Monospace', value: 'Monaco, Courier, monospace' },
    { label: 'Sans-serif', value: 'Arial, Helvetica, sans-serif' },
  ]

  return (
    <div className="relative" onMouseLeave={() => setIsOpen(false)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-700'} bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200`}
      >
        Font
      </button>
      {isOpen && (
        <div className="absolute z-10 top-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg">
          {fonts.map(font => (
            <button
              key={font.value}
              type="button"
              onClick={() => {
                if (font.value) {
                  editor.chain().focus().setFontFamily(font.value).run()
                } else {
                  editor.chain().focus().unsetFontFamily().run()
                }
                setIsOpen(false)
              }}
              className="block w-full px-4 py-2 text-left text-gray-900 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              style={{ fontFamily: font.value }}
            >
              {font.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function RichTextEditor({
  content,
  onChange,
  onBlur,
  placeholder = 'Write your response here...',
  disabled = false,
  editable = true,
  className = '',
}: RichTextEditorProps) {
  const canEdit = editable && !disabled
  const containerRef = useRef<HTMLDivElement | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: {
          HTMLAttributes: {
            class: 'bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded font-mono text-sm',
          },
        },
      }),
      Link.configure({
        openOnClick: true,
        validate: href => isSafeLinkHref(href),
        HTMLAttributes: {
          class: 'text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer',
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      Underline,
    ],
    content: content,
    editable: canEdit,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as TiptapContent)
    },
    editorProps: {
      attributes: {
        class:
          'prose dark:prose-invert prose-sm max-w-none focus:outline-none min-h-[300px] h-full px-3 py-2 bg-white dark:bg-gray-900',
      },
    },
  })

  useEffect(() => {
    if (editor && JSON.stringify(content) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(content, false)
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
      className={[
        'border border-gray-300 dark:border-gray-600 rounded-none focus-within:ring-2 focus-within:ring-blue-500 flex flex-col min-h-0',
        className,
      ].join(' ')}
      onBlurCapture={event => {
        if (!onBlur) return
        const relatedTarget = event.relatedTarget as Node | null
        if (relatedTarget && containerRef.current?.contains(relatedTarget)) return
        onBlur()
      }}
    >
      <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="p-2 flex flex-wrap items-center gap-1">
          <IconButton
            icon={Bold}
            label="Bold"
            shortcut="⌘B"
            active={editor.isActive('bold')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <IconButton
            icon={Italic}
            label="Italic"
            shortcut="⌘I"
            active={editor.isActive('italic')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <IconButton
            icon={UnderlineIcon}
            label="Underline"
            shortcut="⌘U"
            active={editor.isActive('underline')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <div className="w-2" />
          <IconButton
            icon={Heading1}
            label="Heading 1"
            shortcut="⌘⌥1"
            active={editor.isActive('heading', { level: 1 })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <IconButton
            icon={Heading2}
            label="Heading 2"
            shortcut="⌘⌥2"
            active={editor.isActive('heading', { level: 2 })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <IconButton
            icon={Heading3}
            label="Heading 3"
            shortcut="⌘⌥3"
            active={editor.isActive('heading', { level: 3 })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <div className="w-2" />
          <IconButton
            icon={List}
            label="Bullet list"
            shortcut="⌘⇧8"
            active={editor.isActive('bulletList')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <IconButton
            icon={ListOrdered}
            label="Ordered list"
            shortcut="⌘⇧7"
            active={editor.isActive('orderedList')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <div className="w-2" />
          <IconButton
            icon={Code}
            label="Code block"
            shortcut="⌘⌥C"
            active={editor.isActive('codeBlock')}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          <IconButton
            icon={LinkIcon}
            label="Link"
            shortcut="⌘K"
            active={editor.isActive('link')}
            disabled={!canEdit}
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
          />
          <div className="w-2" />
          <IconButton
            icon={RemoveFormatting}
            label="Clear formatting"
            active={false}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          />
          <div className="flex-1" />
          <FontFamilyDropdown editor={editor} disabled={!canEdit} />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
