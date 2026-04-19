import type { ClassroomArchiveManifest } from '@/types'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export interface ClassroomArchiveBundle {
  manifest: ClassroomArchiveManifest
  snapshot: Record<string, unknown>
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string) {
  const encoded = textEncoder.encode(value)
  target.set(encoded.slice(0, length), offset)
}

function writeTarOctal(target: Uint8Array, offset: number, length: number, value: number) {
  const octal = Math.max(0, value).toString(8)
  const padded = octal.padStart(length - 1, '0')
  writeTarString(target, offset, length - 1, padded)
  target[offset + length - 1] = 0
}

function buildTarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512)
  writeTarString(header, 0, 100, name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, size)
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000))

  for (let index = 148; index < 156; index += 1) {
    header[index] = 32
  }

  header[156] = '0'.charCodeAt(0)
  writeTarString(header, 257, 6, 'ustar')
  writeTarString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) checksum += byte
  const checksumValue = checksum.toString(8).padStart(6, '0')
  writeTarString(header, 148, 6, checksumValue)
  header[154] = 0
  header[155] = 32

  return header
}

function parseTarString(source: Uint8Array, offset: number, length: number): string {
  const raw = source.slice(offset, offset + length)
  const endIndex = raw.findIndex((byte) => byte === 0)
  return textDecoder.decode(endIndex >= 0 ? raw.slice(0, endIndex) : raw).trim()
}

function parseTarOctal(source: Uint8Array, offset: number, length: number): number {
  const value = parseTarString(source, offset, length).replace(/\0/g, '').trim()
  if (!value) return 0
  return Number.parseInt(value, 8) || 0
}

function isZeroTarBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0)
}

export function encodeClassroomArchivePackage(bundle: ClassroomArchiveBundle): Uint8Array {
  const files = [
    { name: 'manifest.json', content: JSON.stringify(bundle.manifest, null, 2) },
    { name: 'snapshot.json', content: JSON.stringify(bundle.snapshot, null, 2) },
  ]

  const parts: Uint8Array[] = []

  for (const file of files) {
    const contentBytes = textEncoder.encode(file.content)
    const paddingSize = (512 - (contentBytes.length % 512)) % 512
    parts.push(buildTarHeader(file.name, contentBytes.length))
    parts.push(contentBytes)
    if (paddingSize > 0) parts.push(new Uint8Array(paddingSize))
  }

  parts.push(new Uint8Array(1024))

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const archive = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    archive.set(part, offset)
    offset += part.length
  }

  return archive
}

export function decodeClassroomArchivePackage(
  input: ArrayBuffer | Uint8Array
): ClassroomArchiveBundle | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const extractedFiles = new Map<string, string>()
  let offset = 0

  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512)
    if (isZeroTarBlock(header)) break

    const name = parseTarString(header, 0, 100)
    const prefix = parseTarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name
    const size = parseTarOctal(header, 124, 12)

    offset += 512
    const content = bytes.slice(offset, offset + size)
    extractedFiles.set(fullName, textDecoder.decode(content))
    offset += Math.ceil(size / 512) * 512
  }

  const manifestRaw = extractedFiles.get('manifest.json')
  const snapshotRaw = extractedFiles.get('snapshot.json')
  if (!manifestRaw || !snapshotRaw) return null

  try {
    return {
      manifest: JSON.parse(manifestRaw) as ClassroomArchiveManifest,
      snapshot: JSON.parse(snapshotRaw) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}
