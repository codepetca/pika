#!/usr/bin/env node

/**
 * Generate a SESSION_SECRET for .env.local
 * Usage: node scripts/generate-env.js [format]
 * Formats: hex (default), base64, base64url
 */

const crypto = require('crypto')

const format = process.argv[2] || 'hex'

let sessionSecret

switch (format) {
  case 'base64':
    sessionSecret = crypto.randomBytes(32).toString('base64')
    break
  case 'base64url':
    sessionSecret = crypto.randomBytes(32).toString('base64url')
    break
  case 'hex':
  default:
    sessionSecret = crypto.randomBytes(32).toString('hex')
    break
}

console.log('\n✅ Generated SESSION_SECRET:\n')
console.log(sessionSecret)
console.log('\n📝 Add this to your .env.local file:\n')
console.log(`SESSION_SECRET=${sessionSecret}`)
console.log('\n⚠️  Keep this secret and never commit it to version control!\n')
console.log(`Format: ${format} (${sessionSecret.length} characters)\n`)
