const TAR_BLOCK_BYTES = 512
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export type FixtureTarEntry = {
  name: string
  content: Uint8Array
}

function writeString(target: Uint8Array, offset: number, length: number, value: string) {
  target.set(textEncoder.encode(value).slice(0, length), offset)
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number) {
  writeString(target, offset, length - 1, value.toString(8).padStart(length - 1, '0'))
  target[offset + length - 1] = 0
}

function buildHeader(name: string, size: number) {
  const header = new Uint8Array(TAR_BLOCK_BYTES)
  writeString(header, 0, 100, name)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(32, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeString(header, 257, 6, 'ustar')
  writeString(header, 263, 2, '00')

  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeString(header, 148, 6, checksum.toString(8).padStart(6, '0'))
  header[154] = 0
  header[155] = 32
  return header
}

export function fixtureTarTextEntry(name: string, content: string): FixtureTarEntry {
  return { name, content: textEncoder.encode(content) }
}

export function encodeFixtureTar(entries: readonly FixtureTarEntry[]): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    parts.push(buildHeader(entry.name, entry.content.byteLength))
    parts.push(entry.content)
    const padding = (TAR_BLOCK_BYTES - (entry.content.byteLength % TAR_BLOCK_BYTES))
      % TAR_BLOCK_BYTES
    if (padding > 0) parts.push(new Uint8Array(padding))
  }
  parts.push(new Uint8Array(TAR_BLOCK_BYTES * 2))

  const archive = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    archive.set(part, offset)
    offset += part.byteLength
  }
  return archive
}

function readString(source: Uint8Array, offset: number, length: number) {
  const field = source.slice(offset, offset + length)
  const end = field.indexOf(0)
  return textDecoder.decode(end === -1 ? field : field.slice(0, end)).trim()
}

export function decodeFixtureTar(input: Uint8Array): FixtureTarEntry[] {
  const entries: FixtureTarEntry[] = []
  let offset = 0
  while (offset + TAR_BLOCK_BYTES <= input.byteLength) {
    const header = input.slice(offset, offset + TAR_BLOCK_BYTES)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header, 0, 100)
    const size = Number.parseInt(readString(header, 124, 12), 8)
    offset += TAR_BLOCK_BYTES
    entries.push({ name, content: input.slice(offset, offset + size) })
    offset += Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
  }
  return entries
}

export function fixtureTarEntryText(entry: FixtureTarEntry) {
  return textDecoder.decode(entry.content)
}

export function fixtureBundleEntries(bundle: {
  manifest: unknown
  files: Record<string, string>
}): FixtureTarEntry[] {
  return [
    fixtureTarTextEntry('manifest.json', JSON.stringify(bundle.manifest, null, 2)),
    ...Object.entries(bundle.files).map(([name, content]) => fixtureTarTextEntry(name, content)),
  ]
}
