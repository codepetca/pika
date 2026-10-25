import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const files = ['report/bundle-contract.ts', 'report/contract.ts', 'report/calculations.ts', 'report/public.ts', 'engine/repo.ts', 'engine/time.ts', 'engine/types.ts', 'service/contract.ts']
const args = process.argv.slice(2)
const sourceIndex = args.indexOf('--source-root'), revisionIndex = args.indexOf('--revision')
if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error('Pass an explicit --source-root local RepoLight checkout.')
const source = resolve(args[sourceIndex + 1])
const revision = args[revisionIndex + 1] && revisionIndex >= 0 ? args[revisionIndex + 1] : '1e3b5de321f90680f507161340faef1a095d7db2'
const commit = execFileSync('git', ['-C', source, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' }).trim()
const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/contracts/repolight')
const hash = value => createHash('sha256').update(value).digest('hex')
const workingTree = args.includes('--working-tree')
const manifest = { sourceRepository: 'codepetca/repolight', sourceRevision: commit, sourceState: workingTree ? 'working-tree-snapshot' : 'committed', transformVersion: 1, files: [] }
for (const file of files) {
  const sourcePath = `src/lib/${file}`
  const base = execFileSync('git', ['-C', source, 'show', `${commit}:${sourcePath}`], { encoding: 'utf8' })
  const raw = workingTree ? readFileSync(resolve(source, sourcePath), 'utf8') : base
  const transformed = raw.replace(/(from\s+['"])@\/lib\//g, '$1@/lib/contracts/repolight/')
  for (const match of raw.matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    if (!files.includes(match[1].slice('@/lib/'.length) + '.ts')) throw new Error('Canonical contract gained an unreviewed dependency.')
  }
  const target = resolve(destination, file)
  if (args.includes('--check')) { if (readFileSync(target, 'utf8') !== transformed) throw new Error(`Vendored contract drift: ${file}`) }
  else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, transformed) }
  manifest.files.push({ sourcePath, targetPath: file, sourceSha256: hash(raw), parentSourceSha256: hash(base), modifiedFromParent: raw !== base, transformedSha256: hash(transformed) })
}
const serialized = JSON.stringify(manifest, null, 2) + '\n'
const manifestPath = resolve(destination, 'manifest.json')
if (args.includes('--check')) { if (readFileSync(manifestPath, 'utf8') !== serialized) throw new Error('Vendor manifest drift.') }
else writeFileSync(manifestPath, serialized)
console.log(`RepoLight canonical contracts ${args.includes('--check') ? 'verified' : 'synced'} ${workingTree ? 'from an explicit working-tree snapshot with parent' : 'at committed revision'} ${commit}.`)
