# Dependency security remediation — October 2026

The audit found five production dependency advisories in the installed tree.
All existing direct Tiptap packages now resolve together to3.31.4, above the
3.30.4 prototype and3.30.5 Markdown parser fixes. Existing transitive4.x js-yaml
and2.x moment dependencies are bounded by compatible overrides to4.3.2 and2.31.0.
No new direct dependency was introduced.

The [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
still lists no patched release. The installed3.0.3 package therefore has a
version-scoped pnpm patch in `patches/braces@3.0.3.patch`: parse rejects excessive
brace/parenthesis nesting, and compile/expand/stringify bound recursive AST depth
at128. It raises a controlled SyntaxError before native stack exhaustion;
normal glob syntax, quoted/escaped literals and numeric ranges retain their
behavior. Callers still handle malformed pattern errors. This mitigation does
not claim to solve arbitrary cyclic caller-supplied objects or every expansion
resource-limit problem. The checked build glob path is Tailwind → micromatch →
braces; no attacker-controlled runtime glob entry was established by the audit.

`pnpm audit --prod --json` now reports only GHSA-vfj7-8cjw-p6xm because registry
metadata cannot recognize a local patch. Do not suppress the advisory or claim
zero registry vulnerabilities. Keep the patch and installed-dependency regression
until an upstream patched release is available; then upgrade within the supported
major, remove this exact patch and rerun the same deep-nesting/ordinary-glob tests.
The lockfile pins the patch digest so frozen installation detects patch drift.

Owner disposition, 2026-10-05: leave `braces` in place for now. Track the deferred
follow-up in [the roadmap](../core/roadmap.md#deferred-maintenance); the existing
temporary exception review date remains 2026-11-04 (America/Toronto). This decision
does not label the advisory fixed or extend its exception.

`tests/unit/dependency-security.test.ts` exercises the installed transitive
package, including string and caller-supplied AST entry points and safe globs,
and probes Tiptap's actual mergeAttributes against an own prototype key. Nine
regressions failed before the update/patch; all ten then passed. Existing editor,
Markdown round-trip, content/schema and managed-image tests are required alongside
these controls. Pattern Lab editor/viewer checks use synthetic content and no
uploads or database writes; they do not establish deployed data behavior.
