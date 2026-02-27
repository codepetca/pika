import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const WORKTREE = process.cwd()
const ROOT = resolve(WORKTREE, 'artifacts', 'marketing')
const PUBLISH_ROOT = resolve(ROOT, 'publish')

const SOURCE_DIRS = [
  { name: 'screens', path: resolve(ROOT, 'screens') },
  { name: 'video', path: resolve(ROOT, 'video') },
  { name: 'audio', path: resolve(ROOT, 'audio') },
  { name: 'captions', path: resolve(ROOT, 'captions') },
]

const COPY_FILES = [
  { source: resolve(WORKTREE, 'docs', 'marketing', 'voiceover-60s.txt'), destinationDir: 'copy' },
  { source: resolve(WORKTREE, 'docs', 'marketing', 'pika-web-publish-notes.md'), destinationDir: 'copy' },
  { source: resolve(WORKTREE, 'docs', 'marketing', 'runbook.md'), destinationDir: 'copy' },
]

type ManifestFile = {
  path: string
  bytes: number
}

type ManifestSection = {
  section: string
  files: ManifestFile[]
}

function copyDirectoryFlat(sourceDir: string, destinationDir: string) {
  mkdirSync(destinationDir, { recursive: true })

  if (!existsSync(sourceDir)) {
    return [] as ManifestFile[]
  }

  const files = readdirSync(sourceDir)
    .filter((entry) => statSync(resolve(sourceDir, entry)).isFile())
    .sort()

  return files.map((fileName) => {
    const sourcePath = resolve(sourceDir, fileName)
    const destinationPath = resolve(destinationDir, fileName)
    copyFileSync(sourcePath, destinationPath)

    return {
      path: destinationPath.replace(`${PUBLISH_ROOT}/`, ''),
      bytes: statSync(destinationPath).size,
    }
  })
}

function copySingleFile(source: string, destinationDir: string): ManifestFile | null {
  if (!existsSync(source)) return null

  mkdirSync(destinationDir, { recursive: true })
  const fileName = source.split('/').pop() as string
  const destinationPath = resolve(destinationDir, fileName)

  copyFileSync(source, destinationPath)

  return {
    path: destinationPath.replace(`${PUBLISH_ROOT}/`, ''),
    bytes: statSync(destinationPath).size,
  }
}

function run() {
  rmSync(PUBLISH_ROOT, { recursive: true, force: true })
  mkdirSync(PUBLISH_ROOT, { recursive: true })

  const manifestSections: ManifestSection[] = []

  for (const sourceDir of SOURCE_DIRS) {
    const destination = resolve(PUBLISH_ROOT, sourceDir.name)
    const copied = copyDirectoryFlat(sourceDir.path, destination)
    manifestSections.push({ section: sourceDir.name, files: copied })
  }

  const copiedDocs: ManifestFile[] = []
  for (const entry of COPY_FILES) {
    const copied = copySingleFile(entry.source, resolve(PUBLISH_ROOT, entry.destinationDir))
    if (copied) copiedDocs.push(copied)
  }
  manifestSections.push({ section: 'copy', files: copiedDocs })

  const manifest = {
    generatedAt: new Date().toISOString(),
    root: PUBLISH_ROOT,
    sections: manifestSections,
  }

  const manifestPath = resolve(PUBLISH_ROOT, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`Bundled marketing assets: ${PUBLISH_ROOT}`)
  console.log(`Manifest: ${manifestPath}`)
}

run()
