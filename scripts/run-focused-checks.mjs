#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyChangedPaths } from './classify-ci-changes.mjs'

function parseArguments(argv) {
  const args = { base: 'origin/main', targetBranch: 'main', dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    else if (value === '--base') args.base = argv[++index]
    else if (value === '--target') args.targetBranch = argv[++index]
    else if (value === '--dry-run') args.dryRun = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return args
}

let logDirectory
let checkNumber = 0

function run(command, args, dryRun, label) {
  if (dryRun) {
    console.log(`\n$ ${[command, ...args].map((value) => JSON.stringify(value)).join(' ')}`)
    return
  }
  if (!logDirectory) {
    logDirectory = mkdtempSync(join(tmpdir(), 'pika-focused-'))
    console.log(`Full check logs: ${logDirectory}`)
  }
  const logPath = join(logDirectory, `${++checkNumber}.log`)
  const fd = openSync(logPath, 'w', 0o600)
  const started = performance.now()
  console.log(`Checking ${label}…`)
  try {
    execFileSync(command, args, { stdio: ['ignore', fd, fd] })
  } catch (error) {
    console.error(readFileSync(logPath, 'utf8'))
    throw error
  } finally {
    closeSync(fd)
  }
  const output = readFileSync(logPath, 'utf8').replace(/\x1b\[[0-9;]*m/g, '')
  const summary = output.split('\n').filter((line) => /^\s*(Test Files|Tests)\s/.test(line))
  console.log(`PASS ${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`)
  if (summary.length) console.log(summary.map((line) => line.trim()).join('\n'))
}

function readChangedPaths(base) {
  const committed = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRD', `${base}...HEAD`],
    { encoding: 'utf8' },
  )
  const workingTree = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMRD', 'HEAD'],
    { encoding: 'utf8' },
  )
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
  return [...new Set(
    `${committed}\n${workingTree}\n${untracked}`
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean),
  )].sort()
}

function isTestFile(path) {
  return /^tests\/.+\.(?:test|spec)\.[jt]sx?$/.test(path)
}

function isRelatedSource(path) {
  return /^src\/.+\.[jt]sx?$/.test(path)
}

// Keep package.json as the single workflow-test inventory. Reject commands we
// cannot faithfully combine instead of silently dropping flags or shell steps.
function workflowTestFiles() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const [command, mode, ...files] = (pkg.scripts?.['check:workflow'] ?? '').trim().split(/\s+/)
  if (command !== 'vitest' || mode !== 'run' || files.length === 0 || !files.every(isTestFile)) {
    throw new Error('check:workflow must be "vitest run" followed by explicit test paths; update the focused runner if its command changes.')
  }
  return files
}

try {
  const args = parseArguments(process.argv.slice(2))
  const paths = readChangedPaths(args.base)
  const classification = classifyChangedPaths(paths, { targetBranch: args.targetBranch })
  console.log(`Focused checks: ${classification.mode} (${paths.length} changed paths)`)
  if (args.dryRun) console.log(JSON.stringify(classification, null, 2))

  const changedTests = classification.runTestBuild ? paths.filter(isTestFile) : []
  const relatedSources = classification.runTestBuild ? paths.filter(isRelatedSource) : []
  const testInputs = [...new Set([...workflowTestFiles(), ...changedTests, ...relatedSources])]
  // Vitest related includes a test when the input is either that test itself
  // or one of its imports. Each project/specification is therefore run once.
  const testMode = relatedSources.length ? ['related', '--run'] : ['run']
  run('pnpm', ['exec', 'vitest', ...testMode, ...testInputs, '--reporter=dot'], args.dryRun, 'workflow and affected tests')

  if (classification.runTestBuild) {
    run('pnpm', ['run', 'check:architecture'], args.dryRun, 'architecture')
    if (classification.runBrowser) {
      run('pnpm', ['run', 'check:ui-policy'], args.dryRun, 'UI policy')
      run('pnpm', ['run', 'check:design-policy'], args.dryRun, 'design policy')
    }
    run('pnpm', ['exec', 'tsc', '--noEmit'], args.dryRun, 'TypeScript')
    run('pnpm', ['run', 'lint'], args.dryRun, 'lint')
  }

  if (classification.runDatabase) {
    console.log('\nDatabase contracts are selected for final CI. Run the exact focused database harness locally when the changed migration or server contract names one.')
  }
  if (classification.runBrowser) {
    console.log('\nBrowser contracts are selected for final CI. UI changes still require the repository visual-verification workflow before review.')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
