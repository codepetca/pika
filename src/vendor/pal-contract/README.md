# Vendored Pal event contract

This directory copies `packages/contract/src` from the Pal repository at commit
`db9f22e22cbf971744bea7a78a8306f2ae787d65` (the contract landed by Pal PR
#35).

The only Pika-local adaptation removes the `.js` suffix from three relative
imports so Next.js resolves the vendored TypeScript source during its production
build. Contract types, constants, and validation behavior are unchanged.

Pika vendors this small, dependency-free package during the pilot so its
producer tests execute the same validator as Pal ingest without waiting for a
published package. The matching JSON compatibility fixtures live at
`tests/fixtures/pal-contract-v1`.

Do not change contract behavior locally. Change it in Pal first, then replace
this directory and the fixtures together, reapply the import-suffix adaptation,
and record the new Pal commit here.
