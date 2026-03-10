'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, FileText, Link2, Pencil, Trash2, Upload } from 'lucide-react'
import { Button, DialogPanel, Input } from '@/ui'
import {
  MAX_TEST_DOCUMENT_TEXT_LENGTH,
  TEST_DOCUMENT_ACCEPT,
  normalizeTestDocuments,
  isValidHttpUrl,
} from '@/lib/test-documents'
import type { TestDocument } from '@/types'

interface Props {
  testId: string
  documents?: TestDocument[]
  apiBasePath?: string
  isEditable: boolean
  onUpdated: () => void
}

type AddDocumentModal = 'link' | 'text' | 'upload' | null

export function TestDocumentsEditor({
  testId,
  documents = [],
  apiBasePath = '/api/teacher/tests',
  isEditable,
  onUpdated,
}: Props) {
  const [localDocs, setLocalDocs] = useState<TestDocument[]>(() => normalizeTestDocuments(documents))
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [uploadTitle, setUploadTitle] = useState('')
  const [editingDocId, setEditingDocId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editContent, setEditContent] = useState('')
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<AddDocumentModal | 'edit'>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const addMenuId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const normalized = normalizeTestDocuments(documents)
    setLocalDocs(normalized)
  }, [documents])

  const editingDoc = useMemo(
    () => localDocs.find((doc) => doc.id === editingDocId) ?? null,
    [localDocs, editingDocId]
  )

  useEffect(() => {
    if (!isAddMenuOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (!addMenuRef.current) return
      if (!addMenuRef.current.contains(event.target as Node)) {
        setIsAddMenuOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsAddMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isAddMenuOpen])

  function openAddModal(mode: Exclude<AddDocumentModal, null>) {
    if (!isEditable || saving || uploading) return
    setError('')
    setSuccess('')
    setIsAddMenuOpen(false)
    setActiveModal(mode)
    if (mode === 'link') {
      setLinkTitle('')
      setLinkUrl('')
      return
    }
    if (mode === 'text') {
      setTextTitle('')
      setTextContent('')
      return
    }
    setUploadTitle('')
    setSelectedUploadFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function clearModalFields(mode: Exclude<AddDocumentModal, null>) {
    if (mode === 'link') {
      setLinkTitle('')
      setLinkUrl('')
      return
    }
    if (mode === 'text') {
      setTextTitle('')
      setTextContent('')
      return
    }
    setUploadTitle('')
    setSelectedUploadFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function closeAddModal() {
    if (uploading || saving) return
    setActiveModal(null)
    setEditingDocId(null)
  }

  async function persistDocuments(nextDocs: TestDocument[]) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`${apiBasePath}/${testId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: nextDocs }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save documents')
      }

      const normalized = normalizeTestDocuments(data.quiz?.documents || nextDocs)
      setLocalDocs(normalized)
      setSuccess('Documents saved')
      onUpdated()
      return true
    } catch (err: any) {
      setError(err.message || 'Failed to save documents')
      return false
    } finally {
      setSaving(false)
    }
  }

  function openEditModal(doc: TestDocument) {
    if (!isEditable || saving || uploading) return
    setError('')
    setSuccess('')
    setEditingDocId(doc.id)
    setEditTitle(doc.title)
    setEditUrl(doc.url || '')
    setEditContent(doc.content || '')
    setActiveModal('edit')
  }

  async function handleSaveEdit() {
    if (!editingDoc || !isEditable || saving || uploading) return
    const title = editTitle.trim()
    if (!title) {
      setError('Document title is required')
      return
    }

    const nextDocBase: TestDocument = {
      ...editingDoc,
      title: title.slice(0, 120),
    }

    if (editingDoc.source === 'link') {
      const url = editUrl.trim()
      if (!isValidHttpUrl(url)) {
        setError('Document URL must be a valid http/https link')
        return
      }
      nextDocBase.url = url
    }

    if (editingDoc.source === 'text') {
      if (!editContent.trim()) {
        setError('Document text is required')
        return
      }
      nextDocBase.content = editContent.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH)
    }

    const nextDocs = localDocs.map((doc) => (doc.id === editingDoc.id ? nextDocBase : doc))
    const persisted = await persistDocuments(nextDocs)
    if (persisted) {
      closeAddModal()
    }
  }

  async function handleAddLink() {
    if (!isEditable || saving) return
    const title = linkTitle.trim()
    const url = linkUrl.trim()
    if (!title) {
      setError('Document title is required')
      return
    }
    if (!isValidHttpUrl(url)) {
      setError('Document URL must be a valid http/https link')
      return
    }

    const nextDocs = [
      ...localDocs,
      {
        id: crypto.randomUUID(),
        title: title.slice(0, 120),
        url,
        source: 'link' as const,
      },
    ]
    setLocalDocs(nextDocs)
    const persisted = await persistDocuments(nextDocs)
    if (persisted) {
      clearModalFields('link')
      closeAddModal()
    }
  }

  async function handleAddText() {
    if (!isEditable || saving) return
    const title = textTitle.trim()
    const content = textContent
    if (!title) {
      setError('Document title is required')
      return
    }
    if (!content.trim()) {
      setError('Document text is required')
      return
    }

    const nextDocs = [
      ...localDocs,
      {
        id: crypto.randomUUID(),
        title: title.slice(0, 120),
        source: 'text' as const,
        content: content.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH),
      },
    ]
    setLocalDocs(nextDocs)
    const persisted = await persistDocuments(nextDocs)
    if (persisted) {
      clearModalFields('text')
      closeAddModal()
    }
  }

  async function handleUploadFile(file: File) {
    if (!isEditable || uploading || saving) return
    setUploading(true)
    setError('')
    setSuccess('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadRes = await fetch(`${apiBasePath}/${testId}/documents/upload`, {
        method: 'POST',
        body: formData,
      })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) {
        throw new Error(uploadData.error || 'Failed to upload document')
      }

      const title = uploadTitle.trim() || uploadData.title || file.name
      const nextDocs = [
        ...localDocs,
        {
          id: crypto.randomUUID(),
          title: String(title).trim().slice(0, 120),
          url: String(uploadData.url || ''),
          source: 'upload' as const,
        },
      ]

      setLocalDocs(nextDocs)
      const persisted = await persistDocuments(nextDocs)
      if (persisted) {
        clearModalFields('upload')
        closeAddModal()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to upload document')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(docId: string) {
    if (!isEditable || saving) return
    const nextDocs = localDocs.filter((doc) => doc.id !== docId)
    setLocalDocs(nextDocs)
    await persistDocuments(nextDocs)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-success bg-success-bg px-3 py-2 text-sm text-success">
          {success}
        </div>
      )}

      {localDocs.length > 0 && (
        <div className="space-y-2">
          {localDocs.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-default">{doc.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="px-2"
                    onClick={() => openEditModal(doc)}
                    disabled={!isEditable || saving || uploading}
                    aria-label={`Edit ${doc.title}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="px-2"
                    onClick={() => {
                      if (!doc.url) return
                      window.open(doc.url, '_blank', 'noopener,noreferrer')
                    }}
                    disabled={!doc.url}
                    aria-label={`Open ${doc.title}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="px-2"
                    onClick={() => {
                      void handleDelete(doc.id)
                    }}
                    disabled={!isEditable || saving || uploading}
                    aria-label={`Remove ${doc.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <div ref={addMenuRef} className="relative">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsAddMenuOpen((prev) => !prev)}
            disabled={!isEditable || saving || uploading}
            className="gap-1.5"
            aria-label="Add Document"
            aria-haspopup="menu"
            aria-expanded={isAddMenuOpen}
            aria-controls={addMenuId}
          >
            Add Document
            <ChevronDown className="h-4 w-4" />
          </Button>
          {isAddMenuOpen && (
            <div
              id={addMenuId}
              role="menu"
              className="absolute left-1/2 z-20 mt-1 w-44 -translate-x-1/2 rounded-md border border-border-strong bg-surface p-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-default hover:bg-surface-hover"
                onClick={() => openAddModal('link')}
              >
                <Link2 className="h-4 w-4" />
                Link
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-default hover:bg-surface-hover"
                onClick={() => openAddModal('text')}
              >
                <FileText className="h-4 w-4" />
                Text
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-text-default hover:bg-surface-hover"
                onClick={() => openAddModal('upload')}
              >
                <Upload className="h-4 w-4" />
                PDF
              </button>
            </div>
          )}
        </div>
      </div>

      <DialogPanel
        isOpen={activeModal === 'link'}
        onClose={closeAddModal}
        maxWidth="max-w-lg"
        ariaLabelledBy="add-test-link-title"
      >
        <h4 id="add-test-link-title" className="text-base font-semibold text-text-default">
          Add link
        </h4>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Title"
            value={linkTitle}
            onChange={(event) => setLinkTitle(event.target.value)}
            disabled={!isEditable || saving || uploading}
            aria-label="Document title"
          />
          <Input
            placeholder="https://..."
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            disabled={!isEditable || saving || uploading}
            aria-label="Document URL"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={closeAddModal}
            disabled={saving || uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleAddLink()
            }}
            disabled={!isEditable || saving || uploading}
            aria-label="Add link document"
          >
            Add link
          </Button>
        </div>
      </DialogPanel>

      <DialogPanel
        isOpen={activeModal === 'text'}
        onClose={closeAddModal}
        maxWidth="max-w-xl"
        ariaLabelledBy="add-test-text-title"
      >
        <h4 id="add-test-text-title" className="text-base font-semibold text-text-default">
          Add Text
        </h4>
        <div className="mt-4 space-y-2">
          <Input
            placeholder="Title"
            value={textTitle}
            onChange={(event) => setTextTitle(event.target.value)}
            disabled={!isEditable || saving || uploading}
            aria-label="Document title"
          />
          <textarea
            placeholder="Paste text students can reference during the test..."
            value={textContent}
            onChange={(event) => setTextContent(event.target.value.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH))}
            disabled={!isEditable || saving || uploading}
            rows={6}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
            aria-label="Document text"
          />
          <p className="text-xs text-text-muted">
            {textContent.length}/{MAX_TEST_DOCUMENT_TEXT_LENGTH} characters
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={closeAddModal}
            disabled={saving || uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleAddText()
            }}
            disabled={!isEditable || saving || uploading}
            aria-label="Add text document"
          >
            Add Text
          </Button>
        </div>
      </DialogPanel>

      <DialogPanel
        isOpen={activeModal === 'upload'}
        onClose={closeAddModal}
        maxWidth="max-w-lg"
        ariaLabelledBy="upload-test-pdf-title"
      >
        <h4 id="upload-test-pdf-title" className="text-base font-semibold text-text-default">
          Upload pdf
        </h4>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Title (optional)"
            value={uploadTitle}
            onChange={(event) => setUploadTitle(event.target.value)}
            disabled={!isEditable || saving || uploading}
            aria-label="Document title"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={TEST_DOCUMENT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null
              setSelectedUploadFile(file)
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isEditable || saving || uploading}
            className="gap-1.5"
          >
            <Upload className="h-4 w-4" />
            {selectedUploadFile ? 'Choose another file' : 'Choose file'}
          </Button>
          <p className="text-sm text-text-muted">
            {selectedUploadFile ? `Selected: ${selectedUploadFile.name}` : 'No file selected'}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={closeAddModal}
            disabled={saving || uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!selectedUploadFile) {
                setError('Please choose a file to upload')
                return
              }
              void handleUploadFile(selectedUploadFile)
            }}
            disabled={!isEditable || saving || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload pdf'}
          </Button>
        </div>
      </DialogPanel>

      <DialogPanel
        isOpen={activeModal === 'edit' && !!editingDoc}
        onClose={closeAddModal}
        maxWidth={editingDoc?.source === 'text' ? 'max-w-xl' : 'max-w-lg'}
        ariaLabelledBy="edit-test-document-title"
      >
        <h4 id="edit-test-document-title" className="text-base font-semibold text-text-default">
          Edit document
        </h4>
        <div className="mt-4 space-y-3">
          <Input
            placeholder="Title"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            disabled={!isEditable || saving || uploading}
            aria-label="Document title"
          />
          {editingDoc?.source === 'link' && (
            <Input
              placeholder="https://..."
              value={editUrl}
              onChange={(event) => setEditUrl(event.target.value)}
              disabled={!isEditable || saving || uploading}
              aria-label="Document URL"
            />
          )}
          {editingDoc?.source === 'text' && (
            <>
              <textarea
                placeholder="Paste text students can reference during the test..."
                value={editContent}
                onChange={(event) =>
                  setEditContent(event.target.value.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH))
                }
                disabled={!isEditable || saving || uploading}
                rows={6}
                className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                aria-label="Document text"
              />
              <p className="text-xs text-text-muted">
                {editContent.length}/{MAX_TEST_DOCUMENT_TEXT_LENGTH} characters
              </p>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={closeAddModal}
            disabled={saving || uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSaveEdit()
            }}
            disabled={!isEditable || saving || uploading}
          >
            Save
          </Button>
        </div>
      </DialogPanel>

    </div>
  )
}
