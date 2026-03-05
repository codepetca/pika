'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FileText, Link2, Trash2, Upload } from 'lucide-react'
import { Button, Input } from '@/ui'
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

function makeEmptyLinkForm() {
  return { title: '', url: '' }
}

function makeEmptyTextForm() {
  return { title: '', content: '' }
}

export function TestDocumentsEditor({
  testId,
  documents = [],
  apiBasePath = '/api/teacher/tests',
  isEditable,
  onUpdated,
}: Props) {
  const [localDocs, setLocalDocs] = useState<TestDocument[]>(() => normalizeTestDocuments(documents))
  const [savedDocsJson, setSavedDocsJson] = useState(JSON.stringify(normalizeTestDocuments(documents)))
  const [linkForm, setLinkForm] = useState(makeEmptyLinkForm())
  const [textForm, setTextForm] = useState(makeEmptyTextForm())
  const [uploadTitle, setUploadTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const normalized = normalizeTestDocuments(documents)
    setLocalDocs(normalized)
    setSavedDocsJson(JSON.stringify(normalized))
  }, [documents])

  const isDirty = useMemo(
    () => JSON.stringify(localDocs) !== savedDocsJson,
    [localDocs, savedDocsJson]
  )

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
      setSavedDocsJson(JSON.stringify(normalized))
      setSuccess('Documents saved')
      onUpdated()
    } catch (err: any) {
      setError(err.message || 'Failed to save documents')
    } finally {
      setSaving(false)
    }
  }

  function handleLocalDocChange(docId: string, partial: Partial<TestDocument>) {
    setLocalDocs((prev) =>
      prev.map((doc) => (doc.id === docId ? { ...doc, ...partial } : doc))
    )
  }

  async function handleAddLink() {
    if (!isEditable || saving) return
    const title = linkForm.title.trim()
    const url = linkForm.url.trim()
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
    setLinkForm(makeEmptyLinkForm())
    await persistDocuments(nextDocs)
  }

  async function handleAddText() {
    if (!isEditable || saving) return
    const title = textForm.title.trim()
    const content = textForm.content
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
    setTextForm(makeEmptyTextForm())
    await persistDocuments(nextDocs)
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
      setUploadTitle('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      await persistDocuments(nextDocs)
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

      <div className="rounded-lg border border-border bg-surface p-3">
        <h4 className="mb-2 text-sm font-semibold text-text-default">Add Link</h4>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <Input
            placeholder="Title (e.g., Java API)"
            value={linkForm.title}
            onChange={(event) => setLinkForm((prev) => ({ ...prev, title: event.target.value }))}
            disabled={!isEditable || saving || uploading}
          />
          <Input
            placeholder="https://..."
            value={linkForm.url}
            onChange={(event) => setLinkForm((prev) => ({ ...prev, url: event.target.value }))}
            disabled={!isEditable || saving || uploading}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void handleAddLink()
            }}
            disabled={!isEditable || saving || uploading}
            className="gap-1.5"
            aria-label="Add link document"
          >
            <Link2 className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <h4 className="mb-2 text-sm font-semibold text-text-default">Add Text</h4>
        <div className="space-y-2">
          <Input
            placeholder="Title (e.g., Allowed formulas)"
            value={textForm.title}
            onChange={(event) => setTextForm((prev) => ({ ...prev, title: event.target.value }))}
            disabled={!isEditable || saving || uploading}
          />
          <textarea
            placeholder="Paste text students can reference during the test..."
            value={textForm.content}
            onChange={(event) =>
              setTextForm((prev) => ({
                ...prev,
                content: event.target.value.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH),
              }))
            }
            disabled={!isEditable || saving || uploading}
            rows={6}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted">
              {textForm.content.length}/{MAX_TEST_DOCUMENT_TEXT_LENGTH} characters
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void handleAddText()
              }}
              disabled={!isEditable || saving || uploading}
              className="gap-1.5"
              aria-label="Add text document"
            >
              <FileText className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <h4 className="mb-2 text-sm font-semibold text-text-default">Upload Document</h4>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            placeholder="Optional custom title"
            value={uploadTitle}
            onChange={(event) => setUploadTitle(event.target.value)}
            disabled={!isEditable || saving || uploading}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={TEST_DOCUMENT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void handleUploadFile(file)
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
              {uploading ? 'Uploading...' : 'Choose file'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-text-default">Documents ({localDocs.length})</h4>
        {localDocs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-sm text-text-muted">
            No documents yet.
          </p>
        ) : (
          localDocs.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg border border-border bg-surface p-3"
            >
              {doc.source === 'text' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={doc.title}
                      onChange={(event) => handleLocalDocChange(doc.id, { title: event.target.value })}
                      disabled={!isEditable || saving || uploading}
                      aria-label="Document title"
                      className="min-w-[220px] flex-1"
                    />
                    <span className="rounded-md bg-surface-2 px-2 py-1 text-xs text-text-muted">
                      Text
                    </span>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        void handleDelete(doc.id)
                      }}
                      disabled={!isEditable || saving || uploading}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                  <textarea
                    value={doc.content || ''}
                    onChange={(event) =>
                      handleLocalDocChange(doc.id, {
                        content: event.target.value.slice(0, MAX_TEST_DOCUMENT_TEXT_LENGTH),
                      })
                    }
                    disabled={!isEditable || saving || uploading}
                    rows={6}
                    className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                    aria-label="Document text"
                  />
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] md:items-center">
                  <Input
                    value={doc.title}
                    onChange={(event) => handleLocalDocChange(doc.id, { title: event.target.value })}
                    disabled={!isEditable || saving || uploading}
                    aria-label="Document title"
                  />
                  <Input
                    value={doc.url || ''}
                    onChange={(event) => handleLocalDocChange(doc.id, { url: event.target.value })}
                    disabled={!isEditable || saving || uploading}
                    aria-label="Document URL"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (!doc.url) return
                      window.open(doc.url, '_blank', 'noopener,noreferrer')
                    }}
                    disabled={!doc.url}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      void handleDelete(doc.id)
                    }}
                    disabled={!isEditable || saving || uploading}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const baseline = normalizeTestDocuments(JSON.parse(savedDocsJson) as unknown)
            setLocalDocs(baseline)
            setError('')
            setSuccess('')
          }}
          disabled={!isDirty || saving || uploading}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void persistDocuments(localDocs)
          }}
          disabled={!isDirty || saving || uploading}
        >
          {saving ? 'Saving...' : 'Save Documents'}
        </Button>
      </div>
    </div>
  )
}
