#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const FULL_CI_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  '.nvmrc',
  'playwright.config.ts',
  'vitest.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsconfig.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'vercel.json',
])

const ROOT_DOCUMENTS = new Set([
  'AGENTS.md',
  'README.md',
  'DESIGN.md',
  'LICENSE',
  '.github/pull_request_template.md',
])

function normalizedPaths(paths) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))].sort()
}

function isDocumentationPath(path) {
  if (ROOT_DOCUMENTS.has(path) || path.endsWith('.md')) return true
  if (path.startsWith('docs/') || path.startsWith('.ai/')) return true
  if (path.startsWith('.claude/commands/') || path.startsWith('.codex/prompts/')) return true
  if (/^\.codex\/skills\/[^/]+\/(?:SKILL\.md|agents\/[^/]+\.ya?ml)$/.test(path)) return true
  return false
}

function isFullCiPath(path) {
  return FULL_CI_FILES.has(path)
    || path.startsWith('.github/workflows/')
    || path === 'scripts/classify-ci-changes.mjs'
    || path === 'scripts/run-focused-checks.mjs'
}

function isDatabasePath(path) {
  return path.startsWith('supabase/')
    || /^scripts\/(?:seed|seed-tests|clear-and-seed)\.ts$/.test(path)
    || path.startsWith('src/app/api/')
    || path.startsWith('src/lib/server/')
    || path.startsWith('src/types/database')
    || /^scripts\/(?:check|run|inventory)-.*(?:database|migration|archive|purge|storage|supabase)/.test(path)
    || (
      path.startsWith('tests/')
      && /(?:database|migration|archive|purge|storage|supabase|concurrency|contract)/.test(path)
    )
}

function isBrowserPath(path) {
  return path.startsWith('e2e/')
    || /^scripts\/(?:seed|seed-tests|clear-and-seed)\.ts$/.test(path)
    || path === 'src/middleware.ts'
    || path.startsWith('public/')
    || path.startsWith('src/app/')
    || path.startsWith('src/components/')
    || path.startsWith('src/hooks/')
    || path.startsWith('src/styles/')
    || path.startsWith('src/ui/')
}

function isKnownTestBuildPath(path) {
  return path.startsWith('src/')
    || path.startsWith('tests/')
    || path.startsWith('scripts/')
    || path.startsWith('.codex/skills/')
    || path.startsWith('.claude/commands/')
    || path.startsWith('.github/')
    || path === '.gitignore'
}

export function classifyChangedPaths(inputPaths, options = {}) {
  const paths = normalizedPaths(inputPaths)
  const targetBranch = options.targetBranch ?? 'main'
  const headBranch = options.headBranch ?? ''
  const forceFull = options.forceFull === true

  if (forceFull) {
    return {
      mode: 'full',
      reason: 'manual full-CI request',
      paths,
      docsOnly: false,
      runTestBuild: true,
      runDatabase: true,
      runBrowser: true,
      unknownPaths: [],
    }
  }

  if (paths.length === 0) {
    return {
      mode: 'full',
      reason: 'no changed paths were available; fail closed',
      paths,
      docsOnly: false,
      runTestBuild: true,
      runDatabase: true,
      runBrowser: true,
      unknownPaths: [],
    }
  }

  if (targetBranch === 'production') {
    if (!headBranch.startsWith('codex/merge-main-into-production-')) {
      return {
        mode: 'full',
        reason: 'noncanonical production PR; fail closed',
        paths,
        docsOnly: false,
        runTestBuild: true,
        runDatabase: true,
        runBrowser: true,
        unknownPaths: [],
      }
    }
    return {
      mode: 'production-promotion',
      reason: 'production validates the combined merge result; main already ran risk-matched contracts',
      paths,
      docsOnly: false,
      runTestBuild: true,
      runDatabase: false,
      runBrowser: false,
      unknownPaths: [],
    }
  }

  const docsOnly = paths.every(isDocumentationPath)
  if (docsOnly) {
    return {
      mode: 'docs-only',
      reason: 'all changed paths are documentation or AI workflow guidance',
      paths,
      docsOnly: true,
      runTestBuild: false,
      runDatabase: false,
      runBrowser: false,
      unknownPaths: [],
    }
  }

  const unknownPaths = paths.filter((path) => (
    !isDocumentationPath(path)
    && !isFullCiPath(path)
    && !isDatabasePath(path)
    && !isBrowserPath(path)
    && !isKnownTestBuildPath(path)
  ))
  const fullCiPaths = paths.filter(isFullCiPath)

  if (unknownPaths.length > 0 || fullCiPaths.length > 0) {
    const reason = unknownPaths.length > 0
      ? `unknown paths require full CI: ${unknownPaths.join(', ')}`
      : `CI or runtime configuration changed: ${fullCiPaths.join(', ')}`
    return {
      mode: 'full',
      reason,
      paths,
      docsOnly: false,
      runTestBuild: true,
      runDatabase: true,
      runBrowser: true,
      unknownPaths,
    }
  }

  const runDatabase = paths.some(isDatabasePath)
  const runBrowser = paths.some(isBrowserPath)
  return {
    mode: runDatabase && runBrowser
      ? 'application-database-browser'
      : runDatabase
        ? 'application-database'
        : runBrowser
          ? 'application-browser'
          : 'application-test-build',
    reason: 'known paths selected their risk-matched checks',
    paths,
    docsOnly: false,
    runTestBuild: true,
    runDatabase,
    runBrowser,
    unknownPaths: [],
  }
}

function parseArguments(argv) {
  const args = {
    base: null,
    head: null,
    targetBranch: 'main',
    headBranch: '',
    forceFull: false,
    githubOutput: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    else if (value === '--base') args.base = argv[++index]
    else if (value === '--head') args.head = argv[++index]
    else if (value === '--target') args.targetBranch = argv[++index]
    else if (value === '--head-branch') args.headBranch = argv[++index]
    else if (value === '--full') args.forceFull = true
    else if (value === '--github-output') args.githubOutput = argv[++index]
    else throw new Error(`Unknown argument: ${value}`)
  }
  return args
}

function readChangedPaths(args) {
  if (args.forceFull) return []
  if (!args.base || !args.head) {
    throw new Error('--base and --head are required unless --full is used')
  }
  return execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', args.base, args.head],
    { encoding: 'utf8' },
  ).split('\n')
}

function writeGitHubOutputs(path, result) {
  const values = {
    mode: result.mode,
    docs_only: String(result.docsOnly),
    run_test_build: String(result.runTestBuild),
    run_database: String(result.runDatabase),
    run_browser: String(result.runBrowser),
    changed_count: String(result.paths.length),
  }
  appendFileSync(path, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : null
if (invokedPath === import.meta.url) {
  try {
    const args = parseArguments(process.argv.slice(2))
    const result = classifyChangedPaths(readChangedPaths(args), {
      targetBranch: args.targetBranch,
      headBranch: args.headBranch,
      forceFull: args.forceFull,
    })
    console.log(JSON.stringify(result, null, 2))
    if (args.githubOutput) writeGitHubOutputs(args.githubOutput, result)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
