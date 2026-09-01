import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-handler'
import type { ManagedStorageBucket } from '@/lib/server/managed-storage'

type StorageClient = {
  storage: {
    getBucket(bucket: string): Promise<{
      data: { id?: string; public?: boolean } | null
      error: { message?: string } | null
    }>
    from(bucket: string): {
      createSignedUploadUrl(path: string, options: { upsert: boolean }): Promise<{
        data: { signedUrl: string; token: string } | null
        error: { message?: string } | null
      }>
      createSignedUrl(path: string, expiresIn: number): Promise<{
        data: { signedUrl: string } | null
        error: { message?: string } | null
      }>
      info(path: string): Promise<{
        data: { size?: number; contentType?: string; metadata?: Record<string, unknown> } | null
        error: { message?: string } | null
      }>
      getPublicUrl(path: string): {
        data: { publicUrl: string }
      }
    }
  }
}

function buildStorageRedirect(url: string): NextResponse {
  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

export async function createManagedUploadAuthorization(input: {
  supabase: StorageClient
  bucket: ManagedStorageBucket
  path: string
}): Promise<{ signedUrl: string; token: string }> {
  const { data, error } = await input.supabase.storage
    .from(input.bucket)
    .createSignedUploadUrl(input.path, { upsert: false })
  if (error || !data?.token || !data.signedUrl) {
    throw new ApiError(500, 'Failed to prepare file upload')
  }
  return data
}

export async function assertDirectUploadMatchesReservation(input: {
  supabase: StorageClient
  bucket: ManagedStorageBucket
  path: string
  expectedByteSize: number
  expectedContentType: string
}): Promise<void> {
  const { data, error } = await input.supabase.storage.from(input.bucket).info(input.path)
  const metadataSize = typeof data?.metadata?.size === 'number'
    ? data.metadata.size
    : undefined
  const actualSize = data?.size ?? metadataSize
  const metadataType = typeof data?.metadata?.mimetype === 'string'
    ? data.metadata.mimetype
    : undefined
  const actualContentType = (data?.contentType || metadataType || '').trim().toLowerCase()

  if (error || !data || actualSize !== input.expectedByteSize
    || actualContentType !== input.expectedContentType.trim().toLowerCase()) {
    throw new ApiError(400, 'Uploaded file did not match its reservation')
  }
}

export async function getPrivateStorageContentType(input: {
  supabase: StorageClient
  bucket: ManagedStorageBucket
  path: string
  registeredContentType?: string | null
}): Promise<string | null> {
  if (input.registeredContentType?.trim()) {
    return input.registeredContentType.trim().toLowerCase()
  }

  const { data, error } = await input.supabase.storage.from(input.bucket).info(input.path)
  if (error || !data) return null
  const metadataType = typeof data.metadata?.mimetype === 'string'
    ? data.metadata.mimetype
    : undefined
  return (data.contentType || metadataType || '').trim().toLowerCase() || null
}

export async function buildPrivateStorageRedirect(input: {
  supabase: StorageClient
  bucket: ManagedStorageBucket
  path: string
}): Promise<NextResponse> {
  const { data, error } = await input.supabase.storage
    .from(input.bucket)
    .createSignedUrl(input.path, 60)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  return buildStorageRedirect(data.signedUrl)
}

/**
 * Preserve pre-reconciliation URLs only during the public-bucket rollout
 * window. Migration 146 refuses to privatize a bucket until every existing
 * object has a settled managed-storage identity, so this path cannot become a
 * private-object authorization bypass.
 */
export async function buildPublicStorageCompatibilityRedirect(input: {
  supabase: StorageClient
  bucket: 'submission-images' | 'test-documents'
  path: string
}): Promise<NextResponse | null> {
  const { data: bucket, error } = await input.supabase.storage.getBucket(input.bucket)
  if (error || bucket?.id !== input.bucket || bucket.public !== true) return null

  const { data } = input.supabase.storage.from(input.bucket).getPublicUrl(input.path)
  if (!data.publicUrl) return null
  return buildStorageRedirect(data.publicUrl)
}
