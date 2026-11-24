import postcss from 'postcss'
import ts from 'typescript'

const tokens = new Set(['--color-calendar-announcement', '--color-calendar-announcement-bg', '--color-calendar-announcement-hover'])
const broad = () => ({ mode: 'broad', surfaces: [] })
const mask = (source, spans) => spans.sort((a, b) => b[0] - a[0]).reduce(
  (text, [start, end]) => text.slice(0, start) + '\u0000' + text.slice(end), source)

function calendar(source) {
  const tree = postcss.parse(source)
  const scopes = []
  tree.walkRules(rule => { if (rule.parent === tree && [':root', '.dark'].includes(rule.selector)) scopes.push(rule) })
  if (scopes.length !== 2 || new Set(scopes.map(rule => rule.selector)).size !== 2 ||
      scopes.some(rule => rule.parent !== tree)) return null
  const spans = []
  for (const scope of scopes) {
    const properties = scope.nodes.filter(node => node.type === 'decl').map(node => node.prop)
    if (new Set(properties).size !== properties.length || properties.some(prop => prop.includes('\\'))) return null
  }
  let invalid = false
  tree.walkDecls(decl => {
    if (!tokens.has(decl.prop)) return
    // The advisory trial deliberately supports only literal hexadecimal colors.
    const start = decl.source.start.offset
    const raw = source.slice(start, decl.source.end.offset)
    const match = raw.match(/^(--color-calendar-announcement(?:-bg|-hover)?\s*:\s*)(#[\da-f]{3,8})(\s*;?)$/i)
    if (!scopes.includes(decl.parent) || decl.important || !match ||
        ![3, 4, 6, 8].includes(match[2].length - 1)) { invalid = true; return }
    spans.push([start + match[1].length, start + match[1].length + match[2].length])
  })
  if (invalid || spans.length !== 6 || scopes.some(scope =>
    [...tokens].some(token => scope.nodes.filter(node => node.type === 'decl' && node.prop === token).length !== 1))) return null
  return mask(source, spans)
}

function join(source) {
  const tree = ts.createSourceFile('join.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  if (tree.parseDiagnostics.length) return null
  const candidates = []
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'p' &&
        node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) &&
          attr.name.getText(tree) === 'className' && attr.initializer &&
          ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'text-text-muted mt-2')) candidates.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (candidates.length !== 1) return null
  const node = candidates[0]
  if (node.openingElement.attributes.properties.length !== 1 || node.children.length !== 1 ||
      !ts.isJsxText(node.children[0]) || !node.children[0].text.trim()) return null
  return mask(source, [[node.children[0].pos, node.children[0].end]])
}

const surfaces = { 'src/styles/tokens.css': ['calendar', calendar], 'src/app/join/page.tsx': ['join', join] }

/** Advisory only: callers must supply the complete diff, including every changed path. */
export function assessAppearanceDiff(changes) {
  try {
    if (!Array.isArray(changes) || !changes.length) return broad()
    const seen = new Set()
    const selected = new Set()
    for (const change of changes) {
      if (!change || Object.getPrototypeOf(change) !== Object.prototype ||
          Reflect.ownKeys(change).sort().join(',') !== 'after,before,path' ||
          typeof change.path !== 'string' || typeof change.before !== 'string' ||
          typeof change.after !== 'string' || change.before === change.after || seen.has(change.path) ||
          !Object.hasOwn(surfaces, change.path)) return broad()
      seen.add(change.path)
      const [surface, normalize] = surfaces[change.path]
      const before = normalize(change.before)
      if (before === null || before !== normalize(change.after)) return broad()
      selected.add(surface)
    }
    return { mode: 'appearance', surfaces: [...selected].sort() }
  } catch { return broad() }
}
