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
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Upload Roster</h2>

        {!result ? (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                CSV File
              </label>
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 mb-3">
                <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                  Format: Student Number, First Name, Last Name, Email
                </div>
                <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs text-gray-800 dark:text-gray-200">
                  <div className="grid grid-cols-[140px_130px_140px_220px] gap-px text-center">
                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 font-semibold">Student Number</span>
                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 font-semibold">First Name</span>
                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 font-semibold">Last Name</span>
                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-1 font-semibold">Email</span>
                    <span className="bg-white dark:bg-gray-900 px-2 py-1">123456</span>
                    <span className="bg-white dark:bg-gray-900 px-2 py-1">Ava</span>
                    <span className="bg-white dark:bg-gray-900 px-2 py-1">Smith</span>
                    <span className="bg-white dark:bg-gray-900 px-2 py-1">ava.smith@example.com</span>
                  </div>
                </div>
              </div>
              <input
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
                Added {result.addedCount} students to roster
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
