const ATTENDANCE_DECOMMISSION_NAMESPACE = 'd8c3403a-2f7c-5df5-99de-42e280b121af'

function uuidBytes(value: string): Uint8Array {
  const hex = value.replaceAll('-', '')
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export async function attendanceDecommissionOperationId(classroomId: string): Promise<string> {
  const name = new TextEncoder().encode(classroomId.toLowerCase())
  const input = new Uint8Array(16 + name.length)
  input.set(uuidBytes(ATTENDANCE_DECOMMISSION_NAMESPACE))
  input.set(name, 16)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  const uuid = digest.slice(0, 16)
  uuid[6] = (uuid[6] & 0x0f) | 0x50
  uuid[8] = (uuid[8] & 0x3f) | 0x80
  return formatUuid(uuid)
}
