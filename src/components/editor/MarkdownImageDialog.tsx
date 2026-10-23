'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { Button, DialogCloseButton, FormField, Input, ModalLayer, Tabs, TabPanel, cn } from '@/ui'
import { fetchMarkdownImageFile, getMarkdownImageValidationError, MARKDOWN_IMAGE_ACCEPT, sanitizeMarkdownImageSrc,
  type MarkdownImageUpload } from '@/lib/markdown-images'

export interface MarkdownImageDialogProps {
  imageUpload?: MarkdownImageUpload
  initialFile?: File
  onInsert: (image: { src: string; alt: string }) => void
  onClose: () => void
}

/** Feature-owned image insertion shared by Markdown-backed authoring surfaces. */
export function MarkdownImageDialog({ imageUpload, initialFile, onInsert, onClose }: MarkdownImageDialogProps) {
  const id = useId()
  const [source, setSource] = useState<'upload' | 'url'>(imageUpload ? 'upload' : 'url')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [alt, setAlt] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<AbortController | null>(null)
  const activeRef = useRef(true)

  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; uploadRef.current?.abort() } }, [])
  useEffect(() => {
    setLoaded(false)
    setError(null)
    if (source === 'upload') {
      if (!file) { setPreview(''); return }
      const objectUrl = URL.createObjectURL(file)
      setPreview(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    setPreview('')
    if (!url.trim()) return
    const src = sanitizeMarkdownImageSrc(url)
    if (!src) { setError('Enter an image URL starting with https:// or http://.'); return }
    const timer = window.setTimeout(() => setPreview(src), 350)
    return () => window.clearTimeout(timer)
  }, [file, source, url])

  function chooseFile(next?: File) {
    if (!next || busy) return
    setLoaded(false)
    const validation = getMarkdownImageValidationError(next)
    if (validation) { setFile(null); setPreview(''); setValidationError(validation); return }
    setError(null)
    setValidationError(null)
    setFile(next)
  }
  useEffect(() => { if (initialFile) chooseFile(initialFile) }, [initialFile]) // File drop/paste starts the same reviewed flow.

  function close() {
    activeRef.current = false
    uploadRef.current?.abort()
    onClose()
  }

  async function insert() {
    if (!loaded || busy || !preview) return
    setError(null)
    try {
      setBusy(true)
      const controller = new AbortController()
      uploadRef.current = controller
      const chosenFile = source === 'url'
        ? await fetchMarkdownImageFile(preview, controller.signal) : file
      if (!activeRef.current || controller.signal.aborted || !chosenFile) return
      const rawSrc = imageUpload ? await imageUpload(chosenFile, controller.signal) : preview
      if (!activeRef.current || controller.signal.aborted) return
      const src = sanitizeMarkdownImageSrc(rawSrc)
      if (!src) throw new Error('The image could not be saved. Try again.')
      onInsert({ src, alt: alt.trim().replace(/\s+/g, ' ') })
      onClose()
    } catch (cause) {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : 'The image could not be uploaded. Try again.')
    } finally { if (activeRef.current) setBusy(false) }
  }

  return <ModalLayer isOpen onClose={close} ariaLabelledBy={`${id}-title`}
    initialFocusRef={imageUpload ? chooseRef : urlRef}
    panelClassName="relative flex max-h-full w-full max-w-md flex-col rounded-dialog bg-surface shadow-dialog">
    <DialogCloseButton onClose={close} label="Close image dialog" />
    <div className="overflow-y-auto p-dialog">
      <h2 id={`${id}-title`} className="mb-4 flex min-h-control items-center pr-11 text-lg font-semibold text-text-default">Insert image</h2>
      <div className="grid gap-4">
        <Tabs ariaLabel="Image source" value={source} onValueChange={(value) => { if (!busy) { setValidationError(null); setLoaded(false); setSource(value) } }}
          items={[{ value: 'upload', label: 'Upload', disabled: !imageUpload || busy }, { value: 'url', label: 'Image URL', disabled: busy }]}
          getTabId={(value) => `${id}-${value}-tab`} getPanelId={(value) => `${id}-${value}-panel`} />
        {source === 'upload' ? <TabPanel id={`${id}-upload-panel`} labelledBy={`${id}-upload-tab`}>
          <div className={cn('flex flex-col items-center gap-2 rounded-control border border-dashed border-border-strong bg-surface-2 p-4 text-center text-sm text-text-default', dragging && 'border-primary bg-surface-selected')}
            onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]) }}>
            <ImageIcon className="h-7 w-7 text-text-muted" aria-hidden="true" />
            <p>Choose an image or drop it here</p>
            <Button ref={chooseRef} type="button" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>Choose file</Button>
            <Input ref={inputRef} type="file" className="hidden" tabIndex={-1} accept={MARKDOWN_IMAGE_ACCEPT}
              aria-label="Choose image file" data-testid="markdown-image-file" disabled={busy}
              onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
            <p className="text-xs text-text-muted">PNG, JPG, GIF or WebP · up to 2 MB</p>
          </div>
        </TabPanel> : <TabPanel id={`${id}-url-panel`} labelledBy={`${id}-url-tab`}>
          <FormField label="Image URL" hint="Paste a link directly to an image.">
            <Input ref={urlRef} type="url" value={url} placeholder="https://example.com/image.jpg" disabled={busy}
              onChange={(event) => { setLoaded(false); setUrl(event.target.value) }} />
          </FormField>
        </TabPanel>}
        {preview && <figure className="grid gap-2">
          <img key={preview} data-testid="markdown-image-preview" src={preview} alt={alt}
            className="h-32 w-full rounded-control bg-surface-2 object-contain"
            onLoad={() => { setLoaded(true); setError(null) }}
            onError={() => { setLoaded(false); setError('We couldn’t load that image. Choose another file or check the image URL.') }} />
          <figcaption className="break-all text-xs text-text-muted">{file && source === 'upload' ? file.name : url}</figcaption>
        </figure>}
        <FormField label="Image description" hint="Helps people using screen readers understand the image.">
          <Input value={alt} placeholder="Describe what the image shows" disabled={busy} onChange={(event) => setAlt(event.target.value)} />
        </FormField>
        {(validationError || error) && <p className="text-sm text-danger" role="alert">{validationError || error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!loaded || busy || !preview || !!error || !!validationError} onClick={() => void insert()} aria-busy={busy}>{busy ? 'Uploading…' : 'Insert image'}</Button>
        </div>
      </div>
    </div>
  </ModalLayer>
}
