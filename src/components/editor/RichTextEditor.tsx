'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, EditorContext, useCurrentEditor, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref, sanitizeLinkHref } from '@/lib/tiptap-content'

// --- Tiptap Core Extensions ---
import { StarterKit } from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Selection } from '@tiptap/extensions'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Underline } from '@tiptap/extension-underline'
import { Markdown } from '@tiptap/markdown'
import { Image } from '@tiptap/extension-image'

// --- UI Primitives ---
import { Spacer } from '@/components/tiptap-ui-primitive/spacer'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '@/components/tiptap-ui-primitive/toolbar'

// --- Tiptap Node ---
import { HorizontalRule } from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension'
import { ImageUploadNode } from '@/components/tiptap-node/image-upload-node'
import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss'
import '@/components/tiptap-node/list-node/list-node.scss'
import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'
import '@/components/tiptap-node/image-node/image-node.scss'
import '@/components/tiptap-node/image-upload-node/image-upload-node.scss'

// --- Tiptap UI ---
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu'
import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu'
import { BlocksDropdownMenu } from '@/components/tiptap-ui/blocks-dropdown-menu'
import { MarksDropdownMenu } from '@/components/tiptap-ui/marks-dropdown-menu'
import { AlignmentDropdownMenu } from '@/components/tiptap-ui/alignment-dropdown-menu'
import { LinkPopover, LinkContent, LinkButton } from '@/components/tiptap-ui/link-popover'
import { MarkButton } from '@/components/tiptap-ui/mark-button'
import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button'

// --- Icons ---
import { ArrowLeftIcon } from '@/components/tiptap-icons/arrow-left-icon'
import { LinkIcon } from '@/components/tiptap-icons/link-icon'

// --- Hooks ---
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint'
import { useWindowSize } from '@/hooks/use-window-size'
import { useCursorVisibility } from '@/hooks/use-cursor-visibility'

// --- Styles ---
import '@/components/tiptap-templates/simple/simple-editor.scss'

// --- UI Primitives ---
import { Button } from '@/components/tiptap-ui-primitive/button'

// --- Image Upload ---
async function uploadImage(
  file: File,
  onProgress?: (event: { progress: number }) => void
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  // Simulate initial progress
  onProgress?.({ progress: 10 })

  const response = await fetch('/api/upload-image', {
    method: 'POST',
    body: formData,
  })

  onProgress?.({ progress: 90 })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to upload image')
  }

  const data = await response.json()
  onProgress?.({ progress: 100 })
  return data.url
}

// Helper to handle pasted images
async function handlePastedImage(
  editor: Editor,
  file: File
): Promise<boolean> {
  try {
    const url = await uploadImage(file)
    editor
      .chain()
      .focus()
      .setImage({ src: url, alt: file.name.replace(/\.[^/.]+$/, '') })
      .run()
    return true
  } catch (error) {
    console.error('Failed to upload pasted image:', error)
    return false
  }
}

export interface RichTextEditorProps {
  content: TiptapContent
  onChange: (content: TiptapContent) => void
  onBlur?: () => void
  onPaste?: (wordCount: number) => void
  onKeystroke?: () => void
  placeholder?: string
  disabled?: boolean
  editable?: boolean
  showToolbar?: boolean
  className?: string
  /** Enable image upload via button, paste, and drag-drop */
  enableImageUpload?: boolean
}

const MainToolbarContent = ({
  onLinkClick,
  isMobile,
  enableImageUpload,
}: {
  onLinkClick: () => void
  isMobile: boolean
  enableImageUpload: boolean
}) => {
  return (
    <>
      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="underline" />
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
        {enableImageUpload && <ImageUploadButton />}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3]} portal={isMobile} />
        <ListDropdownMenu types={['bulletList', 'orderedList', 'taskList']} portal={isMobile} />
        <BlocksDropdownMenu portal={isMobile} />
        <MarksDropdownMenu portal={isMobile} />
        <AlignmentDropdownMenu portal={isMobile} />
      </ToolbarGroup>

      <Spacer />

      <CharacterCount />
    </>
  )
}

function CharacterCount() {
  const { editor } = useCurrentEditor()
  if (!editor) return null
  const count = editor.getText().replace(/\n/g, '').length
  return (
    <span className="text-xs text-text-muted tabular-nums select-none">
      {count}
    </span>
  )
}

const MobileToolbarContent = ({
  onBack,
}: {
  onBack: () => void
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        <LinkIcon className="tiptap-button-icon" />
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    <LinkContent />
  </>
)

export function RichTextEditor({
  content,
  onChange,
  onBlur,
  onPaste,
  onKeystroke,
  placeholder = 'Write your response here...',
  disabled = false,
  editable = true,
  showToolbar = true,
  className = '',
  enableImageUpload = false,
}: RichTextEditorProps) {
  const canEdit = editable && !disabled
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<'main' | 'link'>('main')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build extensions array based on props
  const extensions = [
    StarterKit.configure({
      horizontalRule: false,
      heading: {
        levels: [1, 2, 3],
      },
      link: {
        openOnClick: false,
        enableClickSelection: true,
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
    HorizontalRule,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Typography,
    Superscript,
    Subscript,
    Selection,
    Underline,
    Placeholder.configure({
      placeholder,
      includeChildren: true,  // Check child nodes for content (fixes placeholder showing after paste)
    }),
    Markdown,  // Enables markdown parsing for setContent/getMarkdown
    // Image extensions (always included for rendering, upload only when enabled)
    Image.configure({
      HTMLAttributes: {
        class: 'max-w-full h-auto rounded',
      },
    }),
    ...(enableImageUpload
      ? [
          ImageUploadNode.configure({
            type: 'image',
            accept: 'image/*',
            maxSize: 10 * 1024 * 1024, // 10MB
            limit: 1,
            upload: uploadImage,
          }),
        ]
      : []),
  ]

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    editorProps: {
      attributes: {
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        'aria-label': 'Main content area, start typing to enter text.',
        class: 'simple-editor',
      },
      handleDOMEvents: {
        paste: (_view, event) => {
          // Track text paste for authenticity
          if (onPaste) {
            const text = event.clipboardData?.getData('text/plain') ?? ''
            const words = text.trim().split(/\s+/).filter(Boolean).length
            if (words > 0) onPaste(words)
          }
          return false
        },
        keydown: (_view, event) => {
          // Only count key presses that produce characters (skip modifiers, nav, etc.)
          if (onKeystroke && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            onKeystroke()
          }
          return false
        },
        click: (view, event) => {
          const target = event.target as HTMLElement
          const link = target.closest('a[href]')
          if (!link) return false

          const href = link.getAttribute('href')
          if (!href) return false

          // In edit mode: only open on Cmd/Ctrl+click
          if (canEdit) {
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault()
              window.open(href, '_blank', 'noopener,noreferrer')
              return true
            }
            return false
          }

          // In read-only mode: open on any click
          event.preventDefault()
          window.open(href, '_blank', 'noopener,noreferrer')
          return true
        },
      },
    },
    extensions,
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as TiptapContent)
    },
  })

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  // Sync content changes from parent
  useEffect(() => {
    if (editor && JSON.stringify(content) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  // Sync editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit)
    }
  }, [canEdit, editor])

  // Reset mobile view when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileView !== 'main') {
      setMobileView('main')
    }
  }, [isMobile, mobileView])

  // Handle image paste when enabled
  useEffect(() => {
    if (!editor || !enableImageUpload) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      event.preventDefault()
      handlePastedImage(editor, imageFile)
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('paste', handlePaste)

    return () => {
      editorElement.removeEventListener('paste', handlePaste)
    }
  }, [editor, enableImageUpload])

  if (!editor) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`simple-editor-wrapper ${className}`}
      onBlurCapture={(event) => {
        if (!onBlur) return
        const relatedTarget = event.relatedTarget as Node | null
        if (relatedTarget && containerRef.current?.contains(relatedTarget)) return
        onBlur()
      }}
    >
      <EditorContext.Provider value={{ editor }}>
        {canEdit && showToolbar && (
          <Toolbar
            ref={toolbarRef}
            style={{
              ...(isMobile
                ? {
                    bottom: `calc(100% - ${height - rect.y}px)`,
                  }
                : {}),
            }}
          >
            {mobileView === 'main' ? (
              <MainToolbarContent
                onLinkClick={() => setMobileView('link')}
                isMobile={isMobile}
                enableImageUpload={enableImageUpload}
              />
            ) : (
              <MobileToolbarContent onBack={() => setMobileView('main')} />
            )}
          </Toolbar>
        )}

        <EditorContent
          editor={editor}
          role="presentation"
          className="simple-editor-content"
        />
      </EditorContext.Provider>
    </div>
  )
}
