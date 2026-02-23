'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, EditorContext, useCurrentEditor, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref } from '@/lib/tiptap-content'
import { IMAGE_ACCEPT, IMAGE_MAX_SIZE } from '@/lib/image-upload'

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
import { SpellCheck } from 'lucide-react'

// --- Hooks ---
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint'
import { useWindowSize } from '@/hooks/use-window-size'
import { useCursorVisibility } from '@/hooks/use-cursor-visibility'

// --- Styles ---
import '@/components/tiptap-templates/simple/simple-editor.scss'

// --- UI Primitives ---
import { Button } from '@/components/tiptap-ui-primitive/button'

// --- Image Upload ---

// Compression settings
const COMPRESS_THRESHOLD = 500 * 1024 // Compress images over 500KB
const MAX_DIMENSION = 1920 // Max width/height after compression
const JPEG_QUALITY = 0.8 // Quality for JPEG compression
const SPELLCHECK_STORAGE_KEY = 'pika:editor:spellcheck-enabled'

/**
 * Compress an image file using Canvas API
 * - Resizes if larger than MAX_DIMENSION
 * - Converts to JPEG with quality reduction
 */
async function compressImage(file: File): Promise<File> {
  // Skip compression for small files or non-compressible formats
  if (file.size < COMPRESS_THRESHOLD || file.type === 'image/gif') {
    return file
  }

  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      try {
        // Calculate new dimensions
        let { width, height } = img
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width)
            width = MAX_DIMENSION
          } else {
            width = Math.round((width * MAX_DIMENSION) / height)
            height = MAX_DIMENSION
          }
        }

        // Draw to canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file) // Fall back to original
          return
        }
        ctx.drawImage(img, 0, 0, width, height)

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              // Compression didn't help, use original
              resolve(file)
              return
            }
            // Create new file with compressed data
            const compressedFile = new File(
              [blob],
              file.name.replace(/\.[^/.]+$/, '.jpg'),
              { type: 'image/jpeg' }
            )
            resolve(compressedFile)
          },
          'image/jpeg',
          JPEG_QUALITY
        )
      } catch {
        resolve(file) // Fall back to original on error
      }
    }
    img.onerror = () => resolve(file) // Fall back to original on error
    img.src = URL.createObjectURL(file)
  })
}

async function uploadImage(
  file: File,
  onProgress?: (event: { progress: number }) => void
): Promise<string> {
  onProgress?.({ progress: 5 })

  // Compress image before upload
  const processedFile = await compressImage(file)

  const formData = new FormData()
  formData.append('file', processedFile)

  onProgress?.({ progress: 20 })

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

// Helper to handle pasted/dropped images
async function handleImageFile(
  editor: Editor,
  file: File,
  onError?: (message: string) => void
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
    const message = error instanceof Error ? error.message : 'Failed to upload image'
    console.error('Failed to upload image:', error)
    onError?.(message)
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
  /** Show spellcheck toggle even when toolbar is hidden */
  showSpellcheckToggle?: boolean
  className?: string
  /** Enable image upload via button, paste, and drag-drop */
  enableImageUpload?: boolean
  /** Callback when image upload fails */
  onImageUploadError?: (message: string) => void
}

function SpellcheckToggleButton({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <Button
      data-style="ghost"
      data-active-state={enabled ? 'on' : 'off'}
      aria-pressed={enabled}
      aria-label={enabled ? 'Disable spellcheck' : 'Enable spellcheck'}
      tooltip={enabled ? 'Spellcheck on' : 'Spellcheck off'}
      onClick={onToggle}
    >
      <SpellCheck className="tiptap-button-icon" />
    </Button>
  )
}

const MainToolbarContent = ({
  onLinkClick,
  isMobile,
  enableImageUpload,
  spellcheckEnabled,
  onToggleSpellcheck,
}: {
  onLinkClick: () => void
  isMobile: boolean
  enableImageUpload: boolean
  spellcheckEnabled: boolean
  onToggleSpellcheck: () => void
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

      <SpellcheckToggleButton
        enabled={spellcheckEnabled}
        onToggle={onToggleSpellcheck}
      />

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
  showSpellcheckToggle = false,
  className = '',
  enableImageUpload = false,
  onImageUploadError,
}: RichTextEditorProps) {
  const canEdit = editable && !disabled
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true)
  const nativeSpellcheckEnabled = canEdit && spellcheckEnabled
  const isMobile = useIsBreakpoint()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = useState<'main' | 'link'>('main')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build extensions array based on props (memoized to avoid recreating on every render)
  const extensions = useMemo(() => [
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
            accept: IMAGE_ACCEPT,
            maxSize: IMAGE_MAX_SIZE,
            limit: 1,
            upload: uploadImage,
          }),
        ]
      : []),
  ], [enableImageUpload, placeholder])

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    editorProps: {
      attributes: {
        autocomplete: 'off',
        spellcheck: nativeSpellcheckEnabled ? 'true' : 'false',
        autocorrect: nativeSpellcheckEnabled ? 'on' : 'off',
        autocapitalize: nativeSpellcheckEnabled ? 'sentences' : 'off',
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

  // Load persisted user preference for spellcheck from browser storage.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(SPELLCHECK_STORAGE_KEY)
    if (stored === 'false') {
      setSpellcheckEnabled(false)
    }
  }, [])

  // Keep DOM attributes in sync when spellcheck preference changes.
  useEffect(() => {
    if (!editor) return
    const editorElement = editor.view.dom as HTMLElement
    editorElement.setAttribute('spellcheck', nativeSpellcheckEnabled ? 'true' : 'false')
    editorElement.setAttribute('autocorrect', nativeSpellcheckEnabled ? 'on' : 'off')
    editorElement.setAttribute('autocapitalize', nativeSpellcheckEnabled ? 'sentences' : 'off')
  }, [editor, nativeSpellcheckEnabled])

  // Reset mobile view when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileView !== 'main') {
      setMobileView('main')
    }
  }, [isMobile, mobileView])

  // Handle image paste and drag-drop when enabled
  useEffect(() => {
    if (!editor || !enableImageUpload) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      event.preventDefault()
      handleImageFile(editor, imageFile, onImageUploadError)
    }

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      event.preventDefault()
      event.stopPropagation()
      handleImageFile(editor, imageFile, onImageUploadError)
    }

    const handleDragOver = (event: DragEvent) => {
      // Check if dragging files (not editor content)
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('paste', handlePaste)
    editorElement.addEventListener('drop', handleDrop)
    editorElement.addEventListener('dragover', handleDragOver)

    return () => {
      editorElement.removeEventListener('paste', handlePaste)
      editorElement.removeEventListener('drop', handleDrop)
      editorElement.removeEventListener('dragover', handleDragOver)
    }
  }, [editor, enableImageUpload, onImageUploadError])

  if (!editor) {
    return null
  }

  const handleToggleSpellcheck = () => {
    setSpellcheckEnabled((previous) => {
      const next = !previous
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SPELLCHECK_STORAGE_KEY, String(next))
      }
      return next
    })
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
                spellcheckEnabled={nativeSpellcheckEnabled}
                onToggleSpellcheck={handleToggleSpellcheck}
              />
            ) : (
              <MobileToolbarContent onBack={() => setMobileView('main')} />
            )}
          </Toolbar>
        )}

        {canEdit && !showToolbar && showSpellcheckToggle && (
          <div className="flex justify-end pb-1">
            <SpellcheckToggleButton
              enabled={nativeSpellcheckEnabled}
              onToggle={handleToggleSpellcheck}
            />
          </div>
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
