#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep each top-level describe together, including any serial or beforeAll hooks.
// Each Playwright invocation owns a fresh server and repeats project setup.
const projects = ['chromium-desktop-dark', 'chromium-mobile-dark']
const flags = projects.map(project => `--project=${project}`)
const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['e2e:ci'].split(/\s+/)
const temp = mkdtempSync(join(tmpdir(), 'pika-browser-dark-'))
const verifyOnly = process.argv.slice(2).join(' ') === '--verify-only'
if (process.argv.length > 2 && !verifyOnly) throw new Error('Unexpected arguments')

function list(extra = []) {
  const result = spawnSync('pnpm', ['exec', ...script, ...flags, '--list', '--reporter=json', ...extra],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, env: { ...process.env, CI: 'true' } })
  if (result.status !== 0) throw new Error(`Playwright inventory failed: ${result.stderr}`)
  return JSON.parse(result.stdout)
}
function rows(inventory) {
  const result = []
  function visit(suite, titles = [], group = null) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const path = [...titles, spec.title]
        const identity = JSON.stringify([test.projectName, spec.file, spec.line, spec.column, ...path])
        result.push({ project: test.projectName, file: spec.file, line: spec.line, path, identity,
          group: JSON.stringify([spec.file, group ?? spec.title]) })
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title], group ?? child.title)
  }
  for (const file of inventory.suites ?? []) visit(file)
  if (!result.length || new Set(result.map(row => row.identity)).size !== result.length) throw new Error('Empty or duplicate inventory')
  return result
}
function same(actual, expected) {
  return actual.length === expected.length && [...actual].sort().every((value, i) => value === [...expected].sort()[i])
}
try {
  const full = rows(list())
  const setup = full.filter(row => row.project === 'setup').map(row => row.identity)
  const tests = full.filter(row => row.project !== 'setup')
  if (!setup.length || !projects.every(project => tests.some(row => row.project === project)) || tests.some(row => !projects.includes(row.project))) throw new Error('Unexpected dark project inventory')
  const groups = new Map()
  for (const row of tests) {
    if ([row.file, ...row.path].some(part => /[>›\r\n]/.test(part))) throw new Error('Ambiguous Playwright test-list title')
    if (!groups.has(row.group)) groups.set(row.group, [])
    groups.get(row.group).push(row)
  }
  // Contiguous groups retain declaration order; balance by discovered test count.
  const partitions = [[], [], [], []]
  const grouped = [...groups.values()].sort((a, b) => a[0].file.localeCompare(b[0].file) || Math.min(...a.map(row => row.line)) - Math.min(...b.map(row => row.line)))
  let remaining = tests.length, index = 0
  for (const group of grouped) {
    if (index < partitions.length - 1 && partitions[index].length && partitions[index].length >= remaining / (partitions.length - index)) {
      remaining -= partitions[index].length
      index++
    }
    partitions[index].push(...group)
  }
  if (partitions.some(part => !part.length)) throw new Error('Empty dark partition')
  const seen = []
  const paths = partitions.map((partition, i) => {
    const path = join(temp, `part-${i + 1}.txt`)
    writeFileSync(path, partition.map(row => `[${row.project}] > ${row.file} > ${row.path.join(' > ')}`).join('\n') + '\n')
    const selected = rows(list([`--test-list=${path}`]))
    if (!same(selected.map(row => row.identity), [...setup, ...partition.map(row => row.identity)])) throw new Error(`Partition ${i + 1} inventory mismatch`)
    seen.push(...selected.filter(row => row.project !== 'setup').map(row => row.identity))
    return path
  })
  if (!same(seen, tests.map(row => row.identity))) throw new Error('Dark partition union mismatch')
  console.log(`Verified ${tests.length} dark project tests in partitions of ${partitions.map(part => part.length).join(', ')}; setup repeats in each.`)
  if (!verifyOnly) for (const [index, path] of paths.entries()) {
    console.log(`Running dark partition ${index + 1}/${paths.length}`)
    const result = spawnSync('pnpm', ['exec', ...script, ...flags, `--test-list=${path}`], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`Dark partition ${index + 1} failed${result.signal ? ` (${result.signal})` : ''}`)
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
