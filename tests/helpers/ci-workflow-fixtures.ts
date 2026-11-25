// Historical workflow reconstruction predates hosted-only light sharding.
export function serialLightWorkflow(source: string) {
  return source.replace(/^  browser-experience-matrix:\n[\s\S]*?(?=^  [a-z][a-z-]*:\n)/m, body => body
    .replace(/^    name: \$\{\{ matrix\.shard[^\n]+\n/m, '    name: Browser Experience Matrix\n')
    .replace(/^    continue-on-error: \$\{\{ matrix\.advisory \}\}\n    strategy:\n[\s\S]*?(?=^    env:)/m, '')
    .replace(/run: node scripts\/ci-browser-light-partitions\.mjs \$\{\{[^\n]+/, 'run: node scripts/ci-browser-light-partitions.mjs')
    .replace(/^          name: \$\{\{ matrix\.shard[^\n]+/m, '          name: browser-experience-matrix-failure'))
    .replace(/^      light_browser_mode: >-\n[\s\S]*?(?=^    steps:)/m, '')
    .replace(/^          LIGHT_BROWSER_(?:MODE|SERIAL_RECEIPT|SHARD_ONE_RECEIPT|SHARD_TWO_RECEIPT):[^\n]+\n/gm, '')
    .replace(/^          if \[\[ "\$BROWSER_REQUIRED" == "true" \]\]; then\n            echo "Light browser mode: [\s\S]*?^          fi\n/gm, '')
}
