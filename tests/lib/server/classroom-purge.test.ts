import { describe, expect, it, vi } from 'vitest'
import { deleteClassroomPurgeStorageObject } from '@/lib/server/classroom-purge'

function storageAdapter(args: {
  removeError?: unknown
  listError?: unknown
  listedObjects?: Array<{ name: string }>
}) {
  const remove = vi.fn().mockResolvedValue({ error: args.removeError || null })
  const list = vi.fn().mockResolvedValue({
    data: args.listedObjects || [],
    error: args.listError || null,
  })
  const from = vi.fn(() => ({ remove, list }))
  return { adapter: { from }, from, remove, list }
}

describe('classroom purge storage cleanup', () => {
  it('removes the exact object and verifies it is absent', async () => {
    const mock = storageAdapter({})

    await deleteClassroomPurgeStorageObject(
      mock.adapter,
      'assignment-artifacts',
      'teacher/classroom/submission.png',
    )

    expect(mock.from).toHaveBeenCalledWith('assignment-artifacts')
    expect(mock.remove).toHaveBeenCalledWith(['teacher/classroom/submission.png'])
    expect(mock.list).toHaveBeenCalledWith('teacher/classroom', {
      limit: 100,
      search: 'submission.png',
    })
  })

  it('treats an already-missing object as an idempotent cleanup success', async () => {
    const missing = { statusCode: 404, code: 'NoSuchKey' }
    const mock = storageAdapter({
      removeError: missing,
    })

    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'classroom-archives',
      'teacher/classroom/archive.tar.gz',
    )).resolves.toBeUndefined()
  })

  it('fails safely when storage reports a partial deletion', async () => {
    const mock = storageAdapter({ listedObjects: [{ name: 'image.png' }] })

    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'submission-images',
      'teacher/classroom/image.png',
    )).rejects.toThrow('storage_delete_not_verified')
  })

  it('surfaces retryable delete errors without checking a different object', async () => {
    const providerError = { statusCode: 503, code: 'service_unavailable' }
    const mock = storageAdapter({ removeError: providerError })

    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'gradex-analytics-extracts',
      'teacher/classroom/extract.tar.gz',
    )).rejects.toBe(providerError)
    expect(mock.list).not.toHaveBeenCalled()
  })

  it('surfaces retryable verification errors after deletion', async () => {
    const providerError = { statusCode: 503, code: 'service_unavailable' }
    const mock = storageAdapter({ listError: providerError })

    await expect(deleteClassroomPurgeStorageObject(
      mock.adapter,
      'test-documents',
      'teacher/classroom/test.pdf',
    )).rejects.toBe(providerError)
  })
})
