'use client'

import { useState, FormEvent, ChangeEvent, useId } from 'react'
import { Button, DialogPanel } from '@/ui'

interface StudentChange {
  email: string
  current: {
    firstName: string | null
    lastName: string | null
    studentNumber: string | null
    counselorEmail: string | null
  }
  incoming: {
    firstName: string
    lastName: string
    studentNumber: string
    counselorEmail: string | null
  }
}

interface ConfirmationData {
  changes: StudentChange[]
  updateCount: number
  newCount: number
  totalCount: number
  csvText: string
}

interface UploadRosterModalProps {
  isOpen: boolean
  onClose: () => void
  classroomId: string
  onSuccess: () => void | Promise<void>
}

export function UploadRosterModal({ isOpen, onClose, classroomId, onSuccess }: UploadRosterModalProps) {
  const fileInputId = useId()
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)
  const [confirmationData, setConfirmationData] = useState<ConfirmationData | null>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setCsvFile(file)
      setError('')
      setResult(null)
      setConfirmationData(null)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!csvFile) return

    setError('')
    setLoading(true)

    try {
      const text = await csvFile.text()

      const response = await fetch(`/api/teacher/classrooms/${classroomId}/roster/upload-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: text }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload roster')
      }

      // Check if confirmation is needed
      if (data.needsConfirmation) {
        setConfirmationData({
          changes: data.changes,
          updateCount: data.updateCount,
          newCount: data.newCount,
          totalCount: data.totalCount,
          csvText: text,
        })
        return
      }

      setResult(data)
      await onSuccess()
      handleClose()
      return
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmUpload() {
    if (!confirmationData) return

    setError('')
    setLoading(true)

    try {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/roster/upload-csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvData: confirmationData.csvText, confirmed: true }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload roster')
      }

      setResult(data)
      setConfirmationData(null)
      await onSuccess()
      handleClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  function handleCancelConfirmation() {
    setConfirmationData(null)
  }

  function handleClose() {
    setCsvFile(null)
    setError('')
    setResult(null)
    setConfirmationData(null)
    onClose()
  }

  // Confirmation screen - show when existing students would be overwritten
  if (confirmationData) {
    return (
      <DialogPanel
        isOpen={isOpen}
        onClose={handleCancelConfirmation}
        maxWidth="max-w-lg"
        className="p-6"
      >
        <h2 className="text-xl font-bold text-text-default mb-4 flex-shrink-0">Confirm Roster Update</h2>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mb-4 p-4 bg-warning-bg border border-warning rounded">
            <p className="text-sm font-medium text-warning mb-2">
              {confirmationData.updateCount} student{confirmationData.updateCount !== 1 ? 's' : ''} will be updated
            </p>
            <p className="text-xs text-warning">
              {confirmationData.newCount} new student{confirmationData.newCount !== 1 ? 's' : ''} will be added
            </p>
          </div>

          <div className="mb-4">
            <p className="text-sm font-medium text-text-muted mb-2">
              Changes to be made:
            </p>
            <div className="max-h-64 overflow-y-auto border border-border rounded divide-y divide-border">
              {confirmationData.changes.map((change) => {
                const nameChanged = change.current.firstName !== change.incoming.firstName ||
                                   change.current.lastName !== change.incoming.lastName
                const numberChanged = change.current.studentNumber !== change.incoming.studentNumber
                const counselorChanged = change.current.counselorEmail !== change.incoming.counselorEmail
                return (
                  <div key={change.email} className="px-3 py-2 text-xs">
                    <div className="font-medium text-text-muted">
                      {change.current.firstName} {change.current.lastName}
                    </div>
                    <div className="text-text-muted mb-1">{change.email}</div>
                    {nameChanged && (
                      <div className="text-text-muted">
                        Name: <span className="line-through text-danger">{change.current.firstName} {change.current.lastName}</span>
                        {' → '}
                        <span className="text-success">{change.incoming.firstName} {change.incoming.lastName}</span>
                      </div>
                    )}
                    {numberChanged && (
                      <div className="text-text-muted">
                        Student #: <span className="line-through text-danger">{change.current.studentNumber || '(none)'}</span>
                        {' → '}
                        <span className="text-success">{change.incoming.studentNumber || '(none)'}</span>
                      </div>
                    )}
                    {counselorChanged && (
                      <div className="text-text-muted truncate">
                        Counselor: <span className="line-through text-danger">{change.current.counselorEmail || '(none)'}</span>
                        {' → '}
                        <span className="text-success">{change.incoming.counselorEmail || '(none)'}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-text-muted mb-4">
            Updating roster entries will change student metadata (name, student number, counselor email).
            Student submissions and enrollments are not affected.
          </p>

          {error && (
            <div className="mb-4 text-sm text-danger">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 flex-shrink-0">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancelConfirmation}
            disabled={loading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirmUpload}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Uploading...' : 'Confirm Update'}
          </Button>
        </div>
      </DialogPanel>
    )
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleClose}
      maxWidth="max-w-lg"
      className="p-6"
    >
      <h2 className="text-xl font-bold text-text-default mb-4 flex-shrink-0">Upload Roster</h2>

      {!result ? (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="mb-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
            <label className="block text-sm font-medium text-text-muted">
              CSV File Format
            </label>
            <div className="rounded-md border border-border bg-surface text-xs text-text-default overflow-hidden max-w-full">
              <div className="grid grid-cols-[minmax(0,_1.2fr)_minmax(0,_1fr)_minmax(0,_1fr)_minmax(0,_1fr)_minmax(0,_1.2fr)] gap-0 text-center text-[10px] leading-tight">
                {[
                  { label: 'Student Number', optional: false },
                  { label: 'First Name', optional: false },
                  { label: 'Last Name', optional: false },
                  { label: 'Email', optional: false },
                  { label: 'Counselor Email', optional: true },
                ].map(({ label, optional }, index, arr) => (
                  <span
                    key={label}
                    className={`bg-surface-2 py-2 px-1 font-semibold ${
                      index < arr.length - 1 ? 'border-r border-border' : ''
                    } whitespace-nowrap`}
                  >
                    {label}
                    {optional && <span className="text-text-muted font-normal"> (opt)</span>}
                  </span>
                ))}
              </div>
            </div>
            <label htmlFor={fileInputId} className="block text-sm font-medium text-text-muted mb-2">
              Choose CSV file
            </label>
            <div className="rounded-lg border border-dashed border-border bg-surface-2 p-3">
              <input
                id={fileInputId}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={loading}
                className="block w-full text-sm text-text-default
                  file:mr-4 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-info-bg file:text-info
                  hover:file:bg-info-bg
                  disabled:opacity-50"
              />
            </div>
            {error && (
              <div className="text-sm text-danger">
                {error}
              </div>
            )}
          </div>

          <div className="flex gap-3 flex-shrink-0">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !csvFile}
              className="flex-1"
            >
              {loading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="mb-4 p-4 bg-success-bg border border-success rounded">
              <p className="text-sm text-success">
                Successfully processed {result.totalProcessed} students
              </p>
              <p className="text-sm text-success">
                Added {result.upsertedCount} students to roster
              </p>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="mb-4 p-4 bg-warning-bg border border-warning rounded">
                <p className="text-sm font-medium text-warning mb-2">
                  {result.errors.length} errors:
                </p>
                <ul className="text-xs text-warning space-y-1">
                  {result.errors.slice(0, 5).map((err: any, i: number) => (
                    <li key={i}>{err.email}: {err.error}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>... and {result.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <Button onClick={handleClose} className="w-full flex-shrink-0">
            Done
          </Button>
        </div>
      )}
    </DialogPanel>
  )
}
