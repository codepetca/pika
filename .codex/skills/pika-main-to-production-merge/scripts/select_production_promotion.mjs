#!/usr/bin/env node

export function selectProductionPromotion(prs) {
  const matches = prs.filter((pr) => (
    pr.isCrossRepository === false
    && typeof pr.headRefName === 'string'
    && pr.headRefName.startsWith('codex/merge-main-into-production-')
  ))
  if (matches.length > 1) {
    throw new Error('Multiple open same-repository main-to-production PRs exist; consolidate them before continuing.')
  }
  return matches[0] ?? null
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : null
if (invokedPath === import.meta.url) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => {
    try {
      const selected = selectProductionPromotion(JSON.parse(input))
      if (selected) {
        process.stdout.write([
          selected.headRefName,
          selected.url,
          String(selected.isDraft),
        ].join('\t'))
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  })
}
