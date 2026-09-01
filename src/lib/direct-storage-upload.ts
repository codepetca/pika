type DirectUploadReservation = {
  bucket: 'submission-images' | 'test-documents'
  storage_path: string
  upload_url: string
  managed_object_id: string
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json()
    return new Error(data?.error || fallback)
  } catch {
    return new Error(fallback)
  }
}

export async function uploadFileDirectly<T>(input: {
  endpoint: string
  file: File
  metadata: Record<string, unknown>
  onProgress?: (event: { progress: number }) => void
}): Promise<T> {
  input.onProgress?.({ progress: 10 })
  const reserveResponse = await fetch(input.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input.metadata,
      file_name: input.file.name,
      content_type: input.file.type,
      byte_size: input.file.size,
    }),
  })
  if (!reserveResponse.ok) {
    throw await readError(reserveResponse, 'Failed to prepare file upload')
  }

  const reservation = await reserveResponse.json() as DirectUploadReservation
  input.onProgress?.({ progress: 25 })

  const uploadBody = new FormData()
  uploadBody.append('cacheControl', '0')
  uploadBody.append('', input.file)
  const uploadResponse = await fetch(reservation.upload_url, {
    method: 'PUT',
    headers: { 'x-upsert': 'false' },
    body: uploadBody,
  })

  if (!uploadResponse.ok) {
    void fetch(input.endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managed_object_id: reservation.managed_object_id }),
    }).catch(() => {})
    throw new Error('Failed to upload file')
  }

  input.onProgress?.({ progress: 85 })
  const finalizeResponse = await fetch(input.endpoint, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input.metadata,
      managed_object_id: reservation.managed_object_id,
    }),
  })
  if (!finalizeResponse.ok) {
    throw await readError(finalizeResponse, 'Failed to finalize file upload')
  }

  input.onProgress?.({ progress: 100 })
  return finalizeResponse.json() as Promise<T>
}
