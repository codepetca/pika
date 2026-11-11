import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const official = 'https://archive.ubuntu.com/ubuntu'

// Only replace the proven hosted image's mirror-list entry; preserve source files and signing.
export function fallbackMirror({ environment, osRelease, sources, mirrors }) {
  if (environment !== 'github-hosted' || !/^VERSION_ID="?24\.04"?$/m.test(osRelease)
    || !/^URIs:\s*mirror\+file:\/etc\/apt\/apt-mirrors\.txt\s*$/m.test(sources)) return null
  const azureEntry = /^(\s*)http:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?=\s|$)/
  if (!mirrors.split(/\r?\n/).some(line => azureEntry.test(line))) return null
  return mirrors.split(/(\r?\n)/).map(line => line.replace(azureEntry, (_, indent) => `${indent}${official}/`)).join('')
}

export function installBrowser(deps) {
  try { return deps.install() } catch (error) {
    const replacement = deps.plan()
    if (replacement === null) throw error
    return retryWithMirror(deps, replacement)
  }
}
function retryWithMirror(deps, replacement) {
  try {
    deps.replace(replacement)
    return deps.install()
  } finally { deps.restore() }
}

function main() {
  let original
  let dir
  const mirror = '/etc/apt/apt-mirrors.txt'
  try {
    installBrowser({
      plan() {
        if (process.env.RUNNER_ENVIRONMENT !== 'github-hosted') return null
        let osRelease, sources, mirrors
        try {
          osRelease = readFileSync('/etc/os-release', 'utf8')
          sources = readFileSync('/etc/apt/sources.list.d/ubuntu.sources', 'utf8')
          mirrors = readFileSync(mirror, 'utf8')
        } catch { return null }
        const replacement = fallbackMirror({ environment: process.env.RUNNER_ENVIRONMENT, osRelease, sources, mirrors })
        if (replacement !== null) original = mirrors
        return replacement
      },
      replace(content) {
        dir = mkdtempSync(join(tmpdir(), 'pika-apt-mirror-'))
        const path = join(dir, 'mirror-list')
        writeFileSync(path, content, { mode: 0o600 })
        execFileSync('sudo', ['cp', path, mirror], { stdio: 'inherit' })
        console.log('Retrying browser installation with the official Ubuntu archive in place of the Azure mirror.')
      },
      install() { execFileSync('pnpm', ['exec', 'playwright', 'install', '--with-deps', 'chromium'], { stdio: 'inherit' }) },
      restore() {
        const path = join(dir, 'original-mirror-list')
        writeFileSync(path, original, { mode: 0o600 })
        execFileSync('sudo', ['cp', path, mirror], { stdio: 'inherit' })
      },
    })
  } finally { if (dir) rmSync(dir, { recursive: true, force: true }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
