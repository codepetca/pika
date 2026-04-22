'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button, DialogPanel, Input } from '@/ui'
import {
  MAX_TEST_DOCUMENT_TEXT_LENGTH,
  TEST_DOCUMENT_ACCEPT,
  clearTestDocumentSnapshot,
  formatCompactRelativeAge,
  normalizeTestDocuments,
  isValidHttpUrl,
} from '@/lib/test-documents'
import type { TestDocument } from '@/types'

interface Props {
  testId: string
  documents?: TestDocument[]
  apiBasePath?: string
  isEditable: boolean
  onDocumentsChange?: (documents: TestDocument[]) => void
  addButtonPlacement?: 'footer' | 'header' | 'none'
  headerTitle?: string
  externalAddRequest?: {
    id: number
    mode: AddDocumentTab
  } | null
  onExternalAddRequestHandled?: () => void
}

type AddDocumentTab = 'link' | 'upload' | 'text'

export function TestDocumentsEditor({
  testId,
  documents = [],
  apiBasePath = '/api/teacher/tests',
  isEditable,
  onDocumentsChange,
  addButtonPlacement = 'footer',
  headerTitle,
  externalAddRequest,
  onExternalAddRequestHandled,
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
  const [activeAddTab, setActiveAddTab] = useState<AddDocumentTab>('link')
  const [activeModal, setActiveModal] = useState<'add' | 'edit' | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [syncingDocId, setSyncingDocId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const normalized = normalizeTestDocuments(documents)
    setLocalDocs(normalized)
  }, [documents])

  useEffect(() => {
    if (!externalAddRequest) return
    openAddModal(externalAddRequest.mode)
    onExternalAddRequestHandled?.()
  }, [externalAddRequest, onExternalAddRequestHandled])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 30_000)
    return () => {
      window.clearInterval(interval)
    }
  }, [])

  const editingDoc = useMemo(
    () => localDocs.find((doc) => doc.id === editingDocId) ?? null,
    [localDocs, editingDocId]
  )

  function resetAddFormState() {
    setLinkTitle('')
    setLinkUrl('')
    setTextTitle('')
    setTextContent('')
    setUploadTitle('')
    setSelectedUploadFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function openAddModal(mode: AddDocumentTab = activeAddTab) {
    if (!isEditable || saving || uploading) return
    setError('')
    setActiveAddTab(mode)
    resetAddFormState()
    setActiveModal('add')
  }

  function clearModalFields(mode: AddDocumentTab) {
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
      onDocumentsChange?.(normalized)
      return normalized
    } catch (err: any) {
      setError(err.message || 'Failed to save documents')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function syncLinkDocument(
    docId: string,
    options?: {
      failurePrefix?: string
      silent?: boolean
    }
  ) {
    setSyncingDocId(docId)
    if (!options?.silent) {
      setError('')
    }
    try {
      const res = await fetch(`${apiBasePath}/${testId}/documents/${docId}/sync`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync document')
      }

      const normalized = normalizeTestDocuments(data.quiz?.documents || localDocs)
      setLocalDocs(normalized)
      onDocumentsChange?.(normalized)
      return normalized
    } catch (err: any) {
      const prefix = options?.failurePrefix || 'Failed to sync document'
      if (!options?.silent) {
        setError(`${prefix}: ${err.message || 'Unknown error'}`)
      } else {
        console.error(`${prefix}:`, err)
      }
      return null
    } finally {
      setSyncingDocId(null)
    }
  }

  function openEditModal(doc: TestDocument) {
    if (!isEditable || saving || uploading) return
    setError('')
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

    const urlChanged = editingDoc.source === 'link' && editUrl.trim() !== (editingDoc.url || '')

    let nextDocBase: TestDocument = {
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

    if (urlChanged) {
      nextDocBase = clearTestDocumentSnapshot(nextDocBase)
    }

    const nextDocs = localDocs.map((doc) => (doc.id === editingDoc.id ? nextDocBase : doc))
    const persistedDocs = await persistDocuments(nextDocs)
    if (persistedDocs) {
      closeAddModal()
      if (urlChanged) {
        void syncLinkDocument(editingDoc.id, {
          failurePrefix: 'Link saved, but sync failed',
        })
      }
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

    const nextLinkDoc: TestDocument = {
      id: crypto.randomUUID(),
      title: title.slice(0, 120),
      url,
      source: 'link' as const,
    }

    const nextDocs = [
      ...localDocs,
      nextLinkDoc,
    ]
    const persistedDocs = await persistDocuments(nextDocs)
    if (persistedDocs) {
      clearModalFields('link')
      closeAddModal()
      void syncLinkDocument(nextLinkDoc.id, {
        failurePrefix: 'Link saved, but sync failed',
      })
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
    const persistedDocs = await persistDocuments(nextDocs)
    if (persistedDocs) {
      clearModalFields('text')
      closeAddModal()
    }
  }

  async function handleUploadFile(file: File) {
    if (!isEditable || uploading || saving) return
    setUploading(true)
    setError('')
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

      const persistedDocs = await persistDocuments(nextDocs)
      if (persistedDocs) {
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
    await persistDocuments(nextDocs)
  }

  const addDocumentButton = (
    <div>
      <Button
        type="button"
        variant={addButtonPlacement === 'header' ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => openAddModal()}
        disabled={!isEditable || saving || uploading}
        className="gap-1.5"
        aria-label="Add Document"
      >
        <Plus className="h-4 w-4" />
        Add Document
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      {(headerTitle || addButtonPlacement === 'header') && (
        <div className={`flex items-center gap-3 ${headerTitle ? 'justify-between' : 'justify-end'}`}>
          {headerTitle ? (
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-text-default">{headerTitle}</h3>
              <p className="text-sm text-text-muted">
                {localDocs.length} document{localDocs.length === 1 ? '' : 's'}
              </p>
            </div>
          ) : null}
          {isEditable ? addDocumentButton : null}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
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
                  {doc.source === 'link' && (
                    <>
                      {doc.synced_at ? (
                        <span className="text-xs text-text-muted" aria-label={`Synced ${formatCompactRelativeAge(doc.synced_at, nowMs)} ago`}>
                          {formatCompactRelativeAge(doc.synced_at, nowMs)}
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="px-2"
                        onClick={() => {
                          void syncLinkDocument(doc.id)
                        }}
                        disabled={!isEditable || saving || uploading || syncingDocId === doc.id}
                        aria-label={`Refresh ${doc.title}`}
                      >
                        <RefreshCw className={`h-4 w-4 ${syncingDocId === doc.id ? 'animate-spin' : ''}`} />
                      </Button>
                    </>
                  )}
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

      {addButtonPlacement === 'footer' && isEditable ? (
        <div className="flex justify-center">
          {addDocumentButton}
        </div>
      ) : null}

      <DialogPanel
        isOpen={activeModal === 'add'}
        onClose={closeAddModal}
        maxWidth={activeAddTab === 'text' ? 'max-w-xl' : 'max-w-lg'}
        ariaLabelledBy="add-test-document-title"
      >
        <h4 id="add-test-document-title" className="text-base font-semibold text-text-default">
          Add Document
        </h4>
        <div className="mt-4">
          <div role="tablist" aria-label="Document type" className="flex gap-2 border-b border-border">
            {(['link', 'upload', 'text'] as const).map((tab) => {
              const isActive = activeAddTab === tab
              const label = tab === 'upload' ? 'PDF' : tab === 'link' ? 'Link' : 'Text'
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveAddTab(tab)}
                  className={[
                    'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-text-muted hover:text-text-default',
                  ].join(' ')}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {activeAddTab === 'link' ? (
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
          ) : null}

          {activeAddTab === 'text' ? (
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
          ) : null}

          {activeAddTab === 'upload' ? (
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
          ) : null}
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
              if (activeAddTab === 'link') {
                void handleAddLink()
                return
              }
              if (activeAddTab === 'text') {
                void handleAddText()
                return
              }
              if (!selectedUploadFile) {
                setError('Please choose a file to upload')
                return
              }
              void handleUploadFile(selectedUploadFile)
            }}
            disabled={!isEditable || saving || uploading}
            aria-label={
              activeAddTab === 'link'
                ? 'Add link document'
                : activeAddTab === 'text'
                  ? 'Add text document'
                  : 'Upload pdf document'
            }
          >
            {activeAddTab === 'link'
              ? 'Add link'
              : activeAddTab === 'text'
                ? 'Add text'
                : uploading
                  ? 'Uploading...'
                  : 'Upload pdf'}
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
