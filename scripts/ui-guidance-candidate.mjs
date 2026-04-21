#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VALID_SCOPES = new Set(['assignments', 'attendance', 'shared-shell'])
const EXPERIMENTAL_DIR = 'docs/guidance/ui/experimental'
const STABLE_PATH = 'docs/guidance/ui/stable.md'

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseArgs(argv) {
  const args = {
    scope: '',
    files: [],
    diffBase: '',
    title: '',
    out: '',
    stdout: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    switch (token) {
      case '--scope':
        args.scope = argv[index + 1] || ''
        index += 1
        break
      case '--files': {
        let cursor = index + 1
        while (cursor < argv.length && !argv[cursor].startsWith('--')) {
          args.files.push(argv[cursor])
          cursor += 1
        }
        index = cursor - 1
        break
      }
      case '--diff-base':
        args.diffBase = argv[index + 1] || ''
        index += 1
        break
      case '--title':
        args.title = argv[index + 1] || ''
        index += 1
        break
      case '--out':
        args.out = argv[index + 1] || ''
        index += 1
        break
      case '--stdout':
        args.stdout = true
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  return args
}

export function validateArgs(args) {
  if (args.help) return

  if (!VALID_SCOPES.has(args.scope)) {
    throw new Error(`--scope must be one of: ${Array.from(VALID_SCOPES).join(', ')}`)
  }

  const hasFiles = args.files.length > 0
  const hasDiffBase = Boolean(args.diffBase)

  if (hasFiles === hasDiffBase) {
    throw new Error('Provide exactly one of --files or --diff-base')
  }
}

function normalizeRelativeFile(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

export function resolveSourceFiles({ cwd, files, diffBase }) {
  let resolvedFiles = files

  if (diffBase) {
    const diffOutput = execFileSync(
      'git',
      ['diff', '--name-only', `${diffBase}...HEAD`],
      { cwd, encoding: 'utf8' },
    )
    resolvedFiles = diffOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }

  const uniqueFiles = Array.from(new Set(resolvedFiles.map(normalizeRelativeFile))).sort()

  if (uniqueFiles.length === 0) {
    throw new Error('No source files found for candidate guidance draft')
  }

  return uniqueFiles
}

export function resolveOutputPath({ cwd, out, scope, title }) {
  const defaultFilename = `${todayIsoDate()}-${slugify(title || `candidate-${scope}-guidance`)}.md`
  const rawOutputPath = out || `${EXPERIMENTAL_DIR}/${defaultFilename}`
  const absoluteOutputPath = resolve(cwd, rawOutputPath)
  const relativeOutputPath = normalizeRelativeFile(relative(cwd, absoluteOutputPath))

  if (relativeOutputPath === STABLE_PATH) {
    throw new Error('Stable guidance is human-promoted only; refusing to write to docs/guidance/ui/stable.md')
  }

  if (
    relativeOutputPath.startsWith('../') ||
    !relativeOutputPath.startsWith(`${EXPERIMENTAL_DIR}/`)
  ) {
    throw new Error('Candidate guidance drafts may only be written under docs/guidance/ui/experimental/')
  }

  return absoluteOutputPath
}

function scopeHeading(scope) {
  switch (scope) {
    case 'assignments':
      return 'Assignments'
    case 'attendance':
      return 'Attendance'
    case 'shared-shell':
      return 'Shared Shell'
    default:
      return scope
  }
}

export function buildCandidateMarkdown({ scope, sourceFiles, title }) {
  const heading = title || `${scopeHeading(scope)} Candidate Guidance`
  const summaryScope = scopeHeading(scope).toLowerCase()
  const sourceFileLines = sourceFiles.map((file) => `  - ${file}`).join('\n')
  const affectedFileLines = sourceFiles.map((file) => `- \`${file}\``).join('\n')

  return `---
status: experimental
scope:
  - ${scope}
source_files:
${sourceFileLines}
human_review_required: true
generated_at: ${todayIsoDate()}
---

# ${heading}

## Summary

Candidate UI guidance draft for the ${summaryScope} workflow. This draft was generated from the listed source files and requires human review before promotion.

## Affected Screens / Files

${affectedFileLines}

## Observed Pattern

- Review the listed files and capture the concrete interaction, layout, or visual pattern that looks reusable.
- Note whether the pattern already appears in multiple places within the selected workflow.

## Proposed Guidance

- Describe the default behavior that future work should follow if this pattern is reused.
- Call out any required tokens, primitives, or layout constraints.
- State the scope limits so the pattern does not spread accidentally.

## Why This Is Experimental

- Explain what is promising about this pattern.
- Explain what is still unproven, local, or in need of iteration.

## Human Review Required

- Confirm whether the pattern should remain local, stay experimental, or be promoted later.
- Call out any regressions, mobile concerns, or accessibility risks that must be checked first.

## Promotion Criteria

- Used successfully in more than one screen or flow
- No significant usability regressions
- Consistent with stable token and primitive guidance
- Explicit human approval before promotion to stable guidance
`
}

export function printHelp(stdout = process.stdout) {
  stdout.write(`Usage: node scripts/ui-guidance-candidate.mjs --scope <assignments|attendance|shared-shell> (--files <path...> | --diff-base <git-ref>) [--title <title>] [--out <path>] [--stdout]

Examples:
  node scripts/ui-guidance-candidate.mjs --scope assignments --files src/app/classrooms/[classroomId]/StudentAssignmentsTab.tsx src/components/AssignmentModal.tsx
  node scripts/ui-guidance-candidate.mjs --scope attendance --diff-base origin/main --stdout
`)
}

export function runUiGuidanceCandidateCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
} = {}) {
  const args = parseArgs(argv)
  validateArgs(args)

  if (args.help) {
    printHelp(stdout)
    return { markdown: '', outputPath: null }
  }

  const sourceFiles = resolveSourceFiles({
    cwd,
    files: args.files,
    diffBase: args.diffBase,
  })

  const markdown = buildCandidateMarkdown({
    scope: args.scope,
    sourceFiles,
    title: args.title,
  })

  if (args.stdout) {
    stdout.write(markdown)
    return { markdown, outputPath: null }
  }

  const outputPath = resolveOutputPath({
    cwd,
    out: args.out,
    scope: args.scope,
    title: args.title,
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, markdown, 'utf8')
  stdout.write(`${normalizeRelativeFile(relative(cwd, outputPath))}\n`)

  return { markdown, outputPath }
}

function isDirectExecution() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectExecution()) {
  try {
    runUiGuidanceCandidateCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
