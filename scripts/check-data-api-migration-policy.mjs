import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Inspect executable, top-level SQL only. Comments, quoted strings and routine
// bodies cannot satisfy an ACL decision. Unusual/dynamic DDL requires review.
function statements(sql) {
  const result = []
  let statement = '', dynamicPublicDdl = false, bodyRelationAcl = false, stringRoutineBody = false
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end
      statement += ' '
    } else if (sql.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (depth && i < sql.length) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unterminated SQL comment')
      statement += ' '
    } else if (sql[i] === "'") {
      // PostgreSQL also executes string-form DO/AS bodies. Require the supported
      // dollar-quoted form rather than trying to decode every SQL escape syntax.
      if (/^do\b/i.test(statement.trim()) ||
          (/^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(statement.trim()) && /\bas(?:\s+(?:e|u&))?\s*$/i.test(statement))) stringRoutineBody = true
      const escaped = /(?:^|[^a-z0-9_])e$/i.test(statement)
      i++
      let closed = false
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i++] === "'") { closed = true; break }
      }
      if (!closed) throw new Error('Unterminated SQL string')
      statement += ' <string> '
    } else if (sql[i] === '"') {
      const end = sql.indexOf('"', i + 1)
      const name = sql.slice(i + 1, end)
      if (end < 0 || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Use simple lowercase SQL identifiers for migration policy checks')
      statement += name
      i = end + 1
    } else if (sql[i] === '$' && /^\$(?:[a-z_][a-z0-9_]*)?\$/i.test(sql.slice(i))) {
      const tag = sql.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i)[0]
      const end = sql.indexOf(tag, i + tag.length)
      if (end < 0) throw new Error('Unterminated SQL routine body')
      const body = sql.slice(i + tag.length, end)
      if (/\bcreate\s+(?:unlogged\s+)?(?:table|sequence)\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.|[a-z_])/i.test(body) ||
          /\balter\s+table\b[\s\S]*\b(?:smallserial|serial|bigserial|identity)\b/i.test(body)) dynamicPublicDdl = true
      // Relation/default ACLs must be reviewable top-level statements, including
      // statements passed to EXECUTE. Function EXECUTE grants keep their own policy.
      const normalizedBody = body.replace(/\s+/g, ' ')
      if (/\b(?:grant|revoke) [\s\S]*?\bon (?!(?:function|procedure|schema|type)\b)/i.test(normalizedBody) ||
          /\balter\s+default\s+privileges\b/i.test(body)) bodyRelationAcl = true
      statement += ' <body> '
      i = end + tag.length
    } else if (sql[i] === '$' && /^\$[^$\s]+\$/.test(sql.slice(i))) {
      throw new Error('Use ASCII dollar-quote tags for migration policy review')
    } else if (sql[i] === ';') {
      result.push(statement.toLowerCase().trim())
      statement = ''
      i++
    } else statement += sql[i++]
  }
  if (statement.trim()) result.push(statement.toLowerCase().trim())
  return { sql: result, dynamicPublicDdl, bodyRelationAcl, stringRoutineBody }
}

const qualified = name => name.includes('.') ? name.replace(/\s+/g, '') : `public.${name.trim()}`

export function checkDataApiMigration(source) {
  const errors = []
  const { sql, dynamicPublicDdl, bodyRelationAcl, stringRoutineBody } = statements(source)
  if (dynamicPublicDdl) errors.push('dynamic public table DDL requires an explicit policy review')
  if (bodyRelationAcl) errors.push('routine-body relation/default ACLs require top-level policy decisions')
  if (stringRoutineBody) errors.push('use dollar-quoted DO/function/procedure bodies for migration policy review')
  if (sql.some(s => /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b[\s\S]*\bbegin\s+atomic\b/.test(s))) errors.push('use dollar-quoted routine bodies instead of inline BEGIN ATOMIC')
  if (sql.some(s => /^(?:set|select\s+set_config).*\bsearch_path\b/.test(s))) errors.push('use schema-qualified DDL instead of SET search_path')
  const decisions = []
  for (const statement of sql) {
    if (/^alter\s+default\s+privileges\b/.test(statement) && /\bgrant\b[\s\S]*\bon\s+(?:tables|sequences)\b/.test(statement) &&
        (!/\bin\s+schema\b/.test(statement) || /\bin\s+schema\s+[^;]*\bpublic\b/.test(statement))) {
      errors.push('automatic public table/sequence GRANT is forbidden')
    }
    const acl = statement.match(/^(grant|revoke)\s+([\s\S]+?)\s+on\s+(?:(table|sequence)\s+)?([\s\S]+?)\s+(?:to|from)\s+([\s\S]+)$/)
    if (!acl || /^(?:function|procedure|schema|type)\b/.test(acl[4])) continue
    const roles = acl[5].split(',').map(s => s.trim().replace(/^group\s+/, '').split(/\s+/)[0])
    const targets = acl[4].split(',').map(qualified)
    const publicTarget = targets.some(name => name.startsWith('public.')) || /\bin\s+schema\s+public\b/.test(acl[4])
    if (acl[1] === 'grant' && publicTarget && roles.some(role => ['public', 'anon', 'authenticated'].includes(role))) errors.push('public client table/sequence GRANT is forbidden')
    decisions.push({ action: acl[1], privileges: acl[2], roles, targets })
  }
  const objects = []
  for (const statement of sql) {
    const table = statement.match(/^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)/)
    const sequence = statement.match(/^create\s+(?:unlogged\s+)?sequence\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)/)
    if (sequence) objects.push({ name: qualified(sequence[1]), kind: 'sequence' })
    if (table) {
      const name = qualified(table[1])
      objects.push({ name, kind: 'table' })
      for (const column of statement.slice(table[0].length).matchAll(/(?:\(|,)\s*([a-z_][a-z0-9_]*)\s+[^,;]*?\b(?:smallserial|serial|bigserial|identity)\b/g)) {
        objects.push({ name: `${name}_${column[1]}_seq`, kind: 'sequence' })
      }
    }
    const altered = statement.match(/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z_][a-z0-9_]*(?:\s*\.\s*[a-z_][a-z0-9_]*)?)\s+([\s\S]+)$/)
    if (altered) {
      for (const action of altered[2].matchAll(/(?:^|,)\s*(?:add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?|alter\s+(?:column\s+)?)([a-z_][a-z0-9_]*)\s+[^,;]*?\b(?:smallserial|serial|bigserial|identity)\b/g)) {
        if (/^,?\s*alter\b/.test(action[0]) && !/\badd\s+generated\b/.test(action[0])) continue
        objects.push({ name: `${qualified(altered[1])}_${action[1]}_seq`, kind: 'sequence' })
      }
    }
  }
  for (const { name, kind } of objects) {
    if (!name.startsWith('public.')) continue
    const acl = decisions.filter(decision => decision.targets.includes(name))
    if (!acl.some(decision => decision.roles.includes('service_role'))) errors.push(`${name}: missing service_role GRANT or REVOKE`)
    if (!['public', 'anon', 'authenticated'].every(role => acl.some(decision => decision.action === 'revoke' && /^all(?:\s+privileges)?$/.test(decision.privileges) && decision.roles.includes(role)))) errors.push(`${name}: missing client-role REVOKE`)
    const escaped = name.replace('.', '\\s*\\.\\s*')
    const bare = name.slice('public.'.length)
    if (kind === 'table' && !sql.some(s => new RegExp(`^alter\\s+table\\s+(?:only\\s+)?(?:${escaped}|${bare})\\s+enable\\s+row\\s+level\\s+security$`).test(s))) errors.push(`${name}: missing ENABLE ROW LEVEL SECURITY`)
  }
  return [...new Set(errors)]
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve('supabase/migrations')
  const errors = readdirSync(directory).filter(name => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) > 280)
    .flatMap(name => checkDataApiMigration(readFileSync(resolve(directory, name), 'utf8')).map(error => `${name}: ${error}`))
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log('Explicit Data API migration policy passed (legacy 001–280 covered by replay contract).')
}
