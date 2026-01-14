'use client'

import { useState, FormEvent, ChangeEvent, useId } from 'react'
import { Button } from '@/components/Button'

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

  if (!isOpen) return null

  // Confirmation screen - show when existing students would be overwritten
  if (confirmationData) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-w-lg w-full p-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Confirm Roster Update</h2>

          <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
              {confirmationData.updateCount} student{confirmationData.updateCount !== 1 ? 's' : ''} will be updated
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {confirmationData.newCount} new student{confirmationData.newCount !== 1 ? 's' : ''} will be added
            </p>
          </div>

          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Changes to be made:
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded divide-y divide-gray-100 dark:divide-gray-800">
              {confirmationData.changes.map((change) => {
                const nameChanged = change.current.firstName !== change.incoming.firstName ||
                                   change.current.lastName !== change.incoming.lastName
                const numberChanged = change.current.studentNumber !== change.incoming.studentNumber
                const counselorChanged = change.current.counselorEmail !== change.incoming.counselorEmail
                return (
                  <div key={change.email} className="px-3 py-2 text-xs">
                    <div className="font-medium text-gray-700 dark:text-gray-300">
                      {change.current.firstName} {change.current.lastName}
                    </div>
                    <div className="text-gray-500 dark:text-gray-400 mb-1">{change.email}</div>
                    {nameChanged && (
                      <div className="text-gray-500 dark:text-gray-400">
                        Name: <span className="line-through text-red-500 dark:text-red-400">{change.current.firstName} {change.current.lastName}</span>
                        {' → '}
                        <span className="text-green-600 dark:text-green-400">{change.incoming.firstName} {change.incoming.lastName}</span>
                      </div>
                    )}
                    {numberChanged && (
                      <div className="text-gray-500 dark:text-gray-400">
                        Student #: <span className="line-through text-red-500 dark:text-red-400">{change.current.studentNumber || '(none)'}</span>
                        {' → '}
                        <span className="text-green-600 dark:text-green-400">{change.incoming.studentNumber || '(none)'}</span>
                      </div>
                    )}
                    {counselorChanged && (
                      <div className="text-gray-500 dark:text-gray-400">
                        Counselor: <span className="line-through text-red-500 dark:text-red-400">{change.current.counselorEmail || '(none)'}</span>
                        {' → '}
                        <span className="text-green-600 dark:text-green-400">{change.incoming.counselorEmail || '(none)'}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Updating roster entries will change student metadata (name, student number, counselor email).
            Student submissions and enrollments are not affected.
          </p>

          {error && (
            <div className="mb-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3">
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
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-w-lg w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Upload Roster</h2>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <div className="mb-4 space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                CSV File Format
              </label>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-800 dark:text-gray-200 overflow-hidden max-w-full">
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
                      className={`bg-gray-100 dark:bg-gray-800 py-2 px-1 font-semibold ${
                        index < arr.length - 1 ? 'border-r border-gray-200 dark:border-gray-700' : ''
                      } whitespace-nowrap`}
                    >
                      {label}
                      {optional && <span className="text-gray-400 dark:text-gray-500 font-normal"> (opt)</span>}
                    </span>
                  ))}
                </div>
              </div>
              <label htmlFor={fileInputId} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Choose CSV file
              </label>
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
                <input
                  id={fileInputId}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  disabled={loading}
                  className="block w-full text-sm text-gray-900 dark:text-gray-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded file:border-0
                    file:text-sm file:font-medium
                    file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-400
                    hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50
                    disabled:opacity-50"
                />
              </div>
            </div>
            {error && (
              <div className="mb-4 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3">
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
          <div>
            <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded">
              <p className="text-sm text-green-800 dark:text-green-300">
                Successfully processed {result.totalProcessed} students
              </p>
              <p className="text-sm text-green-800 dark:text-green-300">
                Added {result.upsertedCount} students to roster
              </p>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  {result.errors.length} errors:
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1">
                  {result.errors.slice(0, 5).map((err: any, i: number) => (
                    <li key={i}>{err.email}: {err.error}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li>... and {result.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
