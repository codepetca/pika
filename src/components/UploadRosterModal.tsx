'use client'

import { useState, FormEvent, ChangeEvent } from 'react'
import { Button } from '@/components/Button'

interface UploadRosterModalProps {
  isOpen: boolean
  onClose: () => void
  classroomId: string
  onSuccess: () => void
}

export function UploadRosterModal({ isOpen, onClose, classroomId, onSuccess }: UploadRosterModalProps) {
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<any>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setCsvFile(file)
      setError('')
      setResult(null)
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

      setResult(data)
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setCsvFile(null)
    setError('')
    setResult(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Upload Roster</h2>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CSV File
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={loading}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  disabled:opacity-50"
              />
              <p className="mt-2 text-xs text-gray-500">
                Format: Student Number, First Name, Last Name, Email
              </p>
            </div>

            {error && (
              <div className="mb-4 text-sm text-red-600">
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
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded">
              <p className="text-sm text-green-800">
                Successfully processed {result.totalProcessed} students
              </p>
              <p className="text-sm text-green-800">
                Added {result.addedCount} students to roster
              </p>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm font-medium text-yellow-800 mb-2">
                  {result.errors.length} errors:
                </p>
                <ul className="text-xs text-yellow-700 space-y-1">
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
