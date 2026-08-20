const ARCHIVE_OPERATION_NAMESPACE = '6b0cdac2-f67c-5c8d-b6e8-31f278435ad1'

function uuidBytes(value: string): Uint8Array {
  const hex = value.replaceAll('-', '')
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function classroomArchiveOperationId(args: {
  classroomId: string
  archivedAt: string
}): Promise<string> {
  const name = new TextEncoder().encode(`${args.classroomId}:${args.archivedAt}`)
  const input = new Uint8Array(16 + name.length)
  input.set(uuidBytes(ARCHIVE_OPERATION_NAMESPACE))
  input.set(name, 16)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  const uuid = digest.slice(0, 16)
  uuid[6] = (uuid[6] & 0x0f) | 0x50
  uuid[8] = (uuid[8] & 0x3f) | 0x80
  return formatUuid(uuid)
}
