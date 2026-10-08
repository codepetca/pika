# Version-scoped dependency patches

`braces@3.0.3.patch` mitigates GHSA-vfj7-8cjw-p6xm until a patched upstream
release exists. See the [security receipt](../docs/guidance/dependency-security-2026-10.md).

The depth128 bound applies to parse nesting and recursive AST walkers. It is not
user-overridable. The stringify guard retains the previous parent-handling
semantics. `pnpm-workspace.yaml` declares the patch and `pnpm-lock.yaml` pins its
digest; never modify installed node_modules or drop the patch to satisfy audit
metadata. Remove it only alongside a verified upstream replacement and the same
installed-dependency regression tests.
