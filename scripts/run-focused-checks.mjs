#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
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

function run(command, args, dryRun) {
  const rendered = [command, ...args].map((value) => JSON.stringify(value)).join(' ')
  console.log(`\n$ ${rendered}`)
  if (!dryRun) execFileSync(command, args, { stdio: 'inherit' })
}

function readChangedPaths(base) {
  const committed = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`],
    { encoding: 'utf8' },
  )
  const workingTree = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
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

try {
  const args = parseArguments(process.argv.slice(2))
  const paths = readChangedPaths(args.base)
  const classification = classifyChangedPaths(paths, { targetBranch: args.targetBranch })

  console.log(JSON.stringify(classification, null, 2))
  run('pnpm', ['run', 'check:workflow'], args.dryRun)

  if (classification.runTestBuild) {
    const changedTests = paths.filter(isTestFile)
    const relatedSources = paths.filter(isRelatedSource)

    run('pnpm', ['run', 'check:architecture'], args.dryRun)
    if (classification.runBrowser) {
      run('pnpm', ['run', 'check:ui-policy'], args.dryRun)
      run('pnpm', ['run', 'check:design-policy'], args.dryRun)
    }
    if (changedTests.length > 0) {
      run('pnpm', ['exec', 'vitest', 'run', ...changedTests], args.dryRun)
    }
    if (relatedSources.length > 0) {
      run('pnpm', ['exec', 'vitest', 'related', '--run', ...relatedSources], args.dryRun)
    }
    run('pnpm', ['exec', 'tsc', '--noEmit'], args.dryRun)
    run('pnpm', ['run', 'lint'], args.dryRun)
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
