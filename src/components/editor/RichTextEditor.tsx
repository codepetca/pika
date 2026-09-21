'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, EditorContext, useCurrentEditor, useEditor } from '@tiptap/react'
import type { TiptapContent } from '@/types'
import { isSafeLinkHref } from '@/lib/tiptap-content'
import { getImageValidationError, IMAGE_ACCEPT } from '@/lib/image-upload'

// --- Tiptap Core Extensions ---
import { StarterKit } from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Selection } from '@tiptap/extensions'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'

// --- UI Primitives ---
import { Spacer } from '@/components/tiptap-ui-primitive/spacer'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '@/components/tiptap-ui-primitive/toolbar'

// --- Tiptap Node ---
import { HorizontalRule } from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension'
import { ManagedImage } from '@/components/tiptap-node/managed-image-node'
import { ReadOnlyImageUpload } from '@/components/tiptap-node/read-only-image-upload-node'
import { discardDirectUpload, uploadFileDirectly } from '@/lib/direct-storage-upload'
import type { ImageUploadResult } from '@/components/tiptap-node/image-upload-node/image-upload-node-extension'
import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss'
import '@/components/tiptap-node/list-node/list-node.scss'
import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'
import '@/components/tiptap-node/image-node/image-node.scss'

// --- Tiptap UI ---
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu'
import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu'
import { BlocksDropdownMenu } from '@/components/tiptap-ui/blocks-dropdown-menu'
import { MarksDropdownMenu } from '@/components/tiptap-ui/marks-dropdown-menu'
import { AlignmentDropdownMenu } from '@/components/tiptap-ui/alignment-dropdown-menu'
import { LinkPopover, LinkContent, LinkButton } from '@/components/tiptap-ui/link-popover'
import { MarkButton } from '@/components/tiptap-ui/mark-button'
import { ImageUploadButton } from '@/components/tiptap-ui/image-upload-button'
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button'

// --- Icons ---
import { ArrowLeftIcon } from '@/components/tiptap-icons/arrow-left-icon'
import { LinkIcon } from '@/components/tiptap-icons/link-icon'

// --- Hooks ---
import { useIsBreakpoint } from '@/hooks/use-is-breakpoint'
import {
  useHistoryPreviewViewport,
  type HistoryPreviewMode,
} from '@/hooks/useHistoryPreviewViewport'
import type { AssignmentHistoryChange } from '@/lib/assignment-doc-history'
import {
  HistoryPreviewChangeSummary,
  HistoryPreviewMinimap,
} from './HistoryPreviewMinimap'

// --- Styles ---
import '@/components/tiptap-templates/simple/simple-editor.scss'

// --- UI Primitives ---
import { Button } from '@/components/tiptap-ui-primitive/button'
import { Button as AppButton, Input as AppInput } from '@/ui'

// --- Image Upload ---

// Compression settings
const COMPRESS_THRESHOLD = 500 * 1024 // Compress images over 500KB
const MAX_DIMENSION = 1920 // Max width/height after compression
const JPEG_QUALITY = 0.8 // Quality for JPEG compression

type TransientImageUploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; progress: number }
  | { status: 'error'; file: File; message: string }

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
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
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
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}

async function uploadImage(
  file: File,
  onProgress?: (event: { progress: number }) => void,
  assignmentDocId?: string,
): Promise<ImageUploadResult> {
  onProgress?.({ progress: 5 })

  // Compress image before upload
  const processedFile = await compressImage(file)

  if (!assignmentDocId) throw new Error('Assignment document is required for image uploads')
  const data = await uploadFileDirectly<Record<string, unknown>>({
    endpoint: '/api/upload-image',
    file: processedFile,
    metadata: { assignment_doc_id: assignmentDocId },
    onProgress,
  })
  return {
    url: String(data.url || ''),
    ...(data.managed_object_id
      ? { managedObjectId: String(data.managed_object_id) }
      : {}),
    ...(data.storage_bucket === 'submission-images'
      ? { storageBucket: 'submission-images' as const }
      : {}),
    ...(data.storage_path
      ? { storagePath: String(data.storage_path) }
      : {}),
  }
}

export interface RichTextEditorProps {
  id?: string
  content: TiptapContent
  onChange: (content: TiptapContent) => void
  onBlur?: () => void
  onPaste?: (wordCount: number) => void
  onKeystroke?: () => void
  onEscape?: () => void
  placeholder?: string
  disabled?: boolean
  editable?: boolean
  autoFocus?: boolean
  /**
   * Governs the amount of formatting UI shown for this authoring task.
   * Prefer this over `showToolbar` for new call sites.
   */
  toolbarPreset?: RichTextToolbarPreset
  /** @deprecated Use toolbarPreset="none" instead. */
  showToolbar?: boolean
  className?: string
  /** Enable image upload via button, paste, and drag-drop */
  enableImageUpload?: boolean
  /** Assignment document that will atomically adopt uploaded managed images. */
  assignmentDocId?: string
  /** Callback when image upload fails */
  onImageUploadError?: (message: string) => void
  /** Reports whether an upload still needs to finish, retry, or be removed. */
  onImageUploadPendingChange?: (pending: boolean) => void
  required?: boolean
  'aria-required'?: boolean | 'true' | 'false'
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  /** Controls whole-document framing while inspecting assignment history. */
  historyPreviewMode?: HistoryPreviewMode
  /** Changed blocks and deletion anchors for the active history save. */
  historyPreviewChange?: AssignmentHistoryChange | null
}

export type RichTextToolbarPreset =
  | 'none'
  | 'brief'
  | 'compact'
  | 'document'
  | 'markdown-safe'

const MainToolbarContent = ({
  onLinkClick,
  isMobile,
  enableImageUpload,
  onImageUploadRequest,
  canStartImageUpload,
  preset,
}: {
  onLinkClick: () => void
  isMobile: boolean
  enableImageUpload: boolean
  onImageUploadRequest: () => void
  canStartImageUpload: boolean
  preset: Exclude<RichTextToolbarPreset, 'none' | 'brief'>
}) => {
  const isDocument = preset === 'document'
  const isMarkdownSafe = preset === 'markdown-safe'

  return (
    <>
      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        {isDocument && <MarkButton type="underline" />}
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
        {isDocument && enableImageUpload && (
          <ImageUploadButton
            onUploadRequest={onImageUploadRequest}
            canUpload={canStartImageUpload}
          />
        )}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        {(isDocument || isMarkdownSafe) && (
          <HeadingDropdownMenu levels={[1, 2, 3]} portal={isMobile} />
        )}
        <ListDropdownMenu
          types={isDocument ? ['bulletList', 'orderedList', 'taskList'] : ['bulletList', 'orderedList']}
          portal={isMobile}
        />
        {isMarkdownSafe && <MarkButton type="code" aria-label="Inline code" />}
        {isDocument && <BlocksDropdownMenu portal={isMobile} />}
        {isDocument && <MarksDropdownMenu portal={isMobile} />}
        {isDocument && <AlignmentDropdownMenu portal={isMobile} />}
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
  id,
  content,
  onChange,
  onBlur,
  onPaste,
  onKeystroke,
  onEscape,
  placeholder = 'Write your response here...',
  disabled = false,
  editable = true,
  autoFocus = false,
  toolbarPreset = 'document',
  showToolbar = true,
  className = '',
  enableImageUpload = false,
  assignmentDocId,
  onImageUploadError,
  onImageUploadPendingChange,
  required,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-errormessage': ariaErrorMessage,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  historyPreviewMode = 'current',
  historyPreviewChange = null,
}: RichTextEditorProps) {
  const canEdit = editable && !disabled
  const resolvedToolbarPreset: RichTextToolbarPreset =
    showToolbar === false ? 'none' : toolbarPreset
  const visibleToolbarPreset =
    resolvedToolbarPreset === 'none' || resolvedToolbarPreset === 'brief'
      ? null
      : resolvedToolbarPreset
  const isMobile = useIsBreakpoint()
  const [mobileView, setMobileView] = useState<'main' | 'link'>('main')
  const toolbarRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageUploadGenerationRef = useRef(0)
  const imageUploadDocIdRef = useRef(assignmentDocId)
  const imageUploadContextRef = useRef({ assignmentDocId, canEdit, mounted: true })
  imageUploadContextRef.current.assignmentDocId = assignmentDocId
  imageUploadContextRef.current.canEdit = canEdit
  const imageUploadStateRef = useRef<TransientImageUploadState>({ status: 'idle' })
  const [imageUploadState, setImageUploadState] = useState<TransientImageUploadState>({ status: 'idle' })
  const { viewportRef, minimapState } = useHistoryPreviewViewport(
    historyPreviewMode,
    content,
    historyPreviewChange,
  )
  const showHistoryMinimap = (
    historyPreviewMode === 'focused' || historyPreviewMode === 'locked'
  ) && historyPreviewChange

  const editorAttributes = useMemo(() => {
    const attributes: Record<string, string> = {
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      class: 'simple-editor',
    }
    const requiredState = ariaRequired ?? required

    if (canEdit) {
      attributes.role = 'textbox'
      attributes['aria-multiline'] = 'true'
    } else {
      attributes.role = 'document'
      attributes['aria-readonly'] = 'true'
    }
    if (id) attributes.id = id
    if (ariaLabelledBy) attributes['aria-labelledby'] = ariaLabelledBy
    else if (ariaLabel) attributes['aria-label'] = ariaLabel
    else attributes['aria-label'] = canEdit ? 'Rich text editor' : 'Rich text content'
    if (requiredState !== undefined) attributes['aria-required'] = String(requiredState)
    if (ariaInvalid !== undefined) attributes['aria-invalid'] = String(ariaInvalid)
    if (ariaDescribedBy) attributes['aria-describedby'] = ariaDescribedBy
    if (ariaErrorMessage) attributes['aria-errormessage'] = ariaErrorMessage

    return attributes
  }, [
    ariaDescribedBy,
    ariaErrorMessage,
    ariaInvalid,
    ariaLabel,
    ariaLabelledBy,
    ariaRequired,
    canEdit,
    id,
    required,
  ])

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
    Placeholder.configure({
      placeholder,
      includeChildren: true,  // Check child nodes for content (fixes placeholder showing after paste)
    }),
    Markdown,  // Enables markdown parsing for setContent/getMarkdown
    // Image extensions (always included for rendering, upload only when enabled)
    ManagedImage.configure({
      HTMLAttributes: {
        class: 'max-w-full h-auto rounded',
      },
    }),
    ReadOnlyImageUpload,
  ], [placeholder])

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    editorProps: {
      attributes: editorAttributes,
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
          if (event.key === 'Escape' && onEscape) {
            event.preventDefault()
            onEscape()
            return true
          }
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
  }, [extensions])

  const updateImageUploadState = useCallback((next: TransientImageUploadState) => {
    imageUploadStateRef.current = next
    setImageUploadState(next)
  }, [])

  const startImageUpload = useCallback(async (file: File, options?: { retry?: boolean }) => {
    const currentStatus = imageUploadStateRef.current.status
    const canRetry = options?.retry === true && currentStatus === 'error'
    if (!editor || !editor.isEditable || (currentStatus !== 'idle' && !canRetry)) return

    const validationError = getImageValidationError(file)
    if (validationError) {
      updateImageUploadState({ status: 'error', file, message: validationError })
      onImageUploadError?.(validationError)
      return
    }

    const generation = imageUploadGenerationRef.current + 1
    const uploadAssignmentDocId = assignmentDocId
    imageUploadGenerationRef.current = generation
    updateImageUploadState({ status: 'uploading', file, progress: 0 })

    let managedObjectId: string | undefined
    let imageInserted = false
    try {
      const result = await uploadImage(
        file,
        ({ progress }) => {
          if (imageUploadGenerationRef.current !== generation) return
          updateImageUploadState({ status: 'uploading', file, progress })
        },
        assignmentDocId,
      )
      managedObjectId = result.managedObjectId
      const currentContext = imageUploadContextRef.current
      if (imageUploadGenerationRef.current !== generation
        || !currentContext.mounted
        || !currentContext.canEdit
        || currentContext.assignmentDocId !== uploadAssignmentDocId
        || !editor.isEditable) {
        if (managedObjectId) {
          void discardDirectUpload({
            endpoint: '/api/upload-image',
            managedObjectId,
          }).catch(() => {})
        }
        return
      }

      imageInserted = editor
        .chain()
        .focus()
        .setImage({
          src: result.url,
          alt: file.name.replace(/\.[^/.]+$/, ''),
          managed_object_id: result.managedObjectId ?? null,
          storage_bucket: result.storageBucket ?? null,
          storage_path: result.storagePath ?? null,
        } as any)
        .run()
      if (!imageInserted) throw new Error('The image uploaded but could not be added to your work')

      updateImageUploadState({ status: 'idle' })
    } catch (error) {
      if (managedObjectId && !imageInserted) {
        void discardDirectUpload({
          endpoint: '/api/upload-image',
          managedObjectId,
        }).catch(() => {})
      }
      if (imageUploadGenerationRef.current !== generation) return
      const message = error instanceof Error ? error.message : 'Failed to upload image'
      console.error('Failed to upload image:', error)
      updateImageUploadState({ status: 'error', file, message })
      onImageUploadError?.(message)
    }
  }, [assignmentDocId, editor, onImageUploadError, updateImageUploadState])

  const requestImageUpload = useCallback(() => {
    if (!editor?.isEditable || imageUploadStateRef.current.status !== 'idle') return
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
      imageInputRef.current.click()
    }
  }, [editor])

  const dismissImageUpload = useCallback(() => {
    imageUploadGenerationRef.current += 1
    updateImageUploadState({ status: 'idle' })
  }, [updateImageUploadState])

  useEffect(() => {
    onImageUploadPendingChange?.(imageUploadState.status !== 'idle')
  }, [imageUploadState.status, onImageUploadPendingChange])

  useEffect(() => {
    if (canEdit || imageUploadStateRef.current.status === 'idle') return
    imageUploadGenerationRef.current += 1
    updateImageUploadState({ status: 'idle' })
  }, [canEdit, updateImageUploadState])

  useEffect(() => {
    if (imageUploadDocIdRef.current === assignmentDocId) return
    imageUploadDocIdRef.current = assignmentDocId
    imageUploadGenerationRef.current += 1
    if (imageUploadStateRef.current.status !== 'idle') {
      updateImageUploadState({ status: 'idle' })
    }
  }, [assignmentDocId, updateImageUploadState])

  useLayoutEffect(() => {
    imageUploadContextRef.current.mounted = true
    return () => {
      imageUploadContextRef.current.mounted = false
      imageUploadGenerationRef.current += 1
    }
  }, [])

  // Sync content changes from parent
  useEffect(() => {
    if (editor && JSON.stringify(content) !== JSON.stringify(editor.getJSON())) {
      editor
        .chain()
        .setMeta('addToHistory', false)
        .setContent(content, { emitUpdate: false })
        .run()
    }
  }, [content, editor])

  // Sync editable state
  useEffect(() => {
    if (editor) {
      // Enabling/disabling the surface is parent-controlled state, not a content
      // edit. Suppress TipTap's update event so autosave consumers do not treat
      // a loading or saving transition as user-authored content.
      editor.setEditable(canEdit, false)
    }
  }, [canEdit, editor])

  useEffect(() => {
    if (editor && canEdit && autoFocus) {
      editor.commands.focus('end')
    }
  }, [autoFocus, canEdit, editor])

  useEffect(() => {
    if (!editor) return
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: editorAttributes,
      },
    })
  }, [editor, editorAttributes])

  // Reset mobile view when switching to desktop
  useEffect(() => {
    if (!isMobile && mobileView !== 'main') {
      setMobileView('main')
    }
  }, [isMobile, mobileView])

  // Handle image paste and drag-drop when enabled
  useEffect(() => {
    if (!editor || !canEdit || !enableImageUpload) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      event.preventDefault()
      void startImageUpload(imageFile)
    }

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (!files?.length) return

      const imageFile = Array.from(files).find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      event.preventDefault()
      event.stopPropagation()
      void startImageUpload(imageFile)
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
  }, [canEdit, editor, enableImageUpload, startImageUpload])

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
        {canEdit && visibleToolbarPreset && (
          <Toolbar
            ref={toolbarRef}
            aria-label="Formatting options"
            data-toolbar-preset={visibleToolbarPreset}
          >
            {mobileView === 'main' ? (
              <MainToolbarContent
                onLinkClick={() => setMobileView('link')}
                isMobile={isMobile}
                enableImageUpload={enableImageUpload}
                onImageUploadRequest={requestImageUpload}
                canStartImageUpload={imageUploadState.status === 'idle'}
                preset={visibleToolbarPreset}
              />
            ) : (
              <MobileToolbarContent onBack={() => setMobileView('main')} />
            )}
          </Toolbar>
        )}

        {canEdit && enableImageUpload ? (
          <AppInput
            ref={imageInputRef}
            className="hidden"
            type="file"
            accept={IMAGE_ACCEPT}
            aria-label="Choose image"
            data-testid="editor-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void startImageUpload(file)
            }}
          />
        ) : null}
        {imageUploadState.status !== 'idle' ? (
          <div
            className={`mx-3 mt-3 flex min-h-11 items-center justify-between gap-3 rounded-control border px-3 py-2 text-sm ${
              imageUploadState.status === 'error'
                ? 'border-danger bg-danger-bg text-danger'
                : 'border-border bg-surface-muted text-text-default'
            }`}
            role={imageUploadState.status === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            aria-busy={imageUploadState.status === 'uploading'}
            data-testid="editor-image-upload-status"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{imageUploadState.file.name}</div>
              <div className="text-xs text-current opacity-80">
                {imageUploadState.status === 'uploading'
                  ? `Uploading image… ${Math.round(imageUploadState.progress)}%`
                  : imageUploadState.message}
              </div>
            </div>
            {imageUploadState.status === 'error' ? (
              <div className="flex shrink-0 gap-2">
                <AppButton
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={() => void startImageUpload(imageUploadState.file, { retry: true })}
                >
                  Retry
                </AppButton>
                <AppButton type="button" size="xs" variant="ghost" onClick={dismissImageUpload}>
                  Remove
                </AppButton>
              </div>
            ) : null}
          </div>
        ) : null}

        {showHistoryMinimap ? (
          <HistoryPreviewChangeSummary change={historyPreviewChange} />
        ) : null}
        <div className="history-preview-layout">
          <EditorContent
            ref={viewportRef}
            editor={editor}
            role="presentation"
            className="simple-editor-content"
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
      </EditorContext.Provider>
    </div>
  )
}
