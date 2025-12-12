#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function findFeaturesFile() {
  let currentDir = process.cwd()

  while (true) {
    const candidate = path.join(currentDir, '.ai', 'features.json')
    if (fs.existsSync(candidate)) {
      return candidate
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  throw new Error('Could not locate .ai/features.json (run from repo root).')
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`)
  }
}

function writeJson(filePath, value) {
  const next = JSON.stringify(value, null, 2) + '\n'
  fs.writeFileSync(filePath, next, 'utf8')
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function computeCounts(features) {
  const total = features.length
  const passing = features.filter(feature => feature.passes === true).length
  const failing = features.filter(feature => feature.passes === false).length
  return { total, passing, failing }
}

function getBlockedBy(feature) {
  if (!feature.blockedBy) return []
  if (!Array.isArray(feature.blockedBy)) return ['__invalid__']
  return feature.blockedBy
}

function validateSchema(json) {
  const errors = []

  if (!json || typeof json !== 'object') {
    return ['Root JSON must be an object']
  }

  if (!json.meta || typeof json.meta !== 'object') {
    errors.push('meta must be an object')
  }

  if (!Array.isArray(json.features)) {
    errors.push('features must be an array')
  }

  const features = Array.isArray(json.features) ? json.features : []

  const ids = new Set()
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') {
      errors.push('each feature must be an object')
      continue
    }

    if (typeof feature.id !== 'string' || feature.id.trim() === '') {
      errors.push('feature.id must be a non-empty string')
    } else if (ids.has(feature.id)) {
      errors.push(`duplicate feature.id: ${feature.id}`)
    } else {
      ids.add(feature.id)
    }

    if (typeof feature.phase !== 'string' || feature.phase.trim() === '') {
      errors.push(`feature.phase missing or invalid (${feature.id ?? 'unknown id'})`)
    }

    if (typeof feature.description !== 'string' || feature.description.trim() === '') {
      errors.push(`feature.description missing or invalid (${feature.id ?? 'unknown id'})`)
    }

    if (typeof feature.passes !== 'boolean') {
      errors.push(`feature.passes must be boolean (${feature.id ?? 'unknown id'})`)
    }

    if (typeof feature.verification !== 'string' || feature.verification.trim() === '') {
      errors.push(`feature.verification missing or invalid (${feature.id ?? 'unknown id'})`)
    }

    if (feature.blockedBy != null && !Array.isArray(feature.blockedBy)) {
      errors.push(`feature.blockedBy must be an array (${feature.id ?? 'unknown id'})`)
    }

    if (Array.isArray(feature.blockedBy)) {
      for (const blockedId of feature.blockedBy) {
        if (typeof blockedId !== 'string' || blockedId.trim() === '') {
          errors.push(`feature.blockedBy contains invalid id (${feature.id})`)
          continue
        }
        if (!ids.has(blockedId) && !features.some(f => f && f.id === blockedId)) {
          errors.push(`feature.blockedBy references unknown id (${feature.id} -> ${blockedId})`)
        }
      }
    }
  }

  if (json.meta && typeof json.meta === 'object') {
    if (typeof json.meta.project !== 'string' || json.meta.project.trim() === '') {
      errors.push('meta.project must be a non-empty string')
    }

    if (typeof json.meta.lastUpdated !== 'string' || json.meta.lastUpdated.trim() === '') {
      errors.push('meta.lastUpdated must be a non-empty string (YYYY-MM-DD)')
    }

    if (typeof json.meta.phase !== 'string' || json.meta.phase.trim() === '') {
      errors.push('meta.phase must be a non-empty string')
    }

    if (typeof json.meta.DO_NOT_DELETE_FEATURES !== 'string' || json.meta.DO_NOT_DELETE_FEATURES.trim() === '') {
      errors.push('meta.DO_NOT_DELETE_FEATURES must be a non-empty string')
    }

    if (json.meta.deletionPolicy !== 'PROHIBITED') {
      errors.push('meta.deletionPolicy must be "PROHIBITED"')
    }
  }

  return errors
}

function updateDerivedMeta(json) {
  const { total, passing, failing } = computeCounts(json.features)

  if (json.meta && typeof json.meta === 'object') {
    json.meta.totalFeatures = total
    json.meta.passing = passing
    json.meta.failing = failing
  }
}

function findFeature(json, id) {
  const feature = json.features.find(featureItem => featureItem.id === id)
  if (!feature) {
    throw new Error(`Feature not found: ${id}`)
  }
  return feature
}

function printSummary(json) {
  updateDerivedMeta(json)

  const { total, passing, failing } = computeCounts(json.features)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Pika Feature Status Summary')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Phase: ${json.meta?.phase ?? 'Unknown'}`)
  console.log(`Total: ${total}`)
  console.log(`Passing: ${passing}`)
  console.log(`Failing: ${failing}`)
  console.log('')

  const next = json.features
    .filter(feature => feature.passes === false)
    .filter(feature => getBlockedBy(feature).length === 0)
    .slice(0, 5)

  console.log('Next (first 5 failing, unblocked):')
  if (next.length === 0) {
    console.log('  (none)')
    return
  }

  for (const feature of next) {
    console.log(`  - [${feature.id}] ${feature.description}`)
  }
}

function printNext(json) {
  const next = json.features
    .filter(feature => feature.passes === false)
    .filter(feature => getBlockedBy(feature).length === 0)

  if (next.length === 0) {
    console.log('(no failing, unblocked features)')
    return
  }

  for (const feature of next) {
    console.log(`[${feature.id}] ${feature.description}`)
    console.log(`  Verify: ${feature.verification}`)
    console.log('')
  }
}

function main() {
  const featuresPath = findFeaturesFile()
  const command = process.argv[2] ?? 'summary'

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('Usage: node scripts/features.mjs <command>')
    console.log('')
    console.log('Commands:')
    console.log('  summary               Show status summary')
    console.log('  next                  List all failing, unblocked features')
    console.log('  detail <id>           Print a feature as JSON')
    console.log('  pass <id>             Mark a feature as passing')
    console.log('  fail <id>             Mark a feature as failing')
    console.log('  validate              Validate features.json schema')
    process.exit(0)
  }

  const json = readJson(featuresPath)

  if (command === 'validate') {
    const errors = validateSchema(json)
    if (errors.length > 0) {
      for (const error of errors) console.error(`❌ ${error}`)
      process.exit(1)
    }
    console.log('✅ features.json valid')
    process.exit(0)
  }

  const errors = validateSchema(json)
  if (errors.length > 0) {
    for (const error of errors) console.error(`❌ ${error}`)
    process.exit(1)
  }

  if (command === 'summary') {
    printSummary(json)
    process.exit(0)
  }

  if (command === 'next') {
    printNext(json)
    process.exit(0)
  }

  if (command === 'detail') {
    const id = process.argv[3]
    if (!id) throw new Error('detail requires <id>')
    const feature = findFeature(json, id)
    console.log(JSON.stringify(feature, null, 2))
    process.exit(0)
  }

  if (command === 'pass' || command === 'fail') {
    const id = process.argv[3]
    if (!id) throw new Error(`${command} requires <id>`)

    const feature = findFeature(json, id)
    const nextPasses = command === 'pass'

    feature.passes = nextPasses
    feature.completedDate = nextPasses ? today() : null
    json.meta.lastUpdated = today()

    updateDerivedMeta(json)
    writeJson(featuresPath, json)

    console.log(nextPasses ? `✅ Marked passing: ${id}` : `❌ Marked failing: ${id}`)
    process.exit(0)
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  main()
} catch (error) {
  console.error(`❌ ${error.message}`)
  process.exit(1)
}

