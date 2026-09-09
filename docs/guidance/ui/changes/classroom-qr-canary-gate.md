# Stable classroom QR canary gate

> Status: retired on 2026-09-08. Stable classroom posters now follow the
> server-checked attendance entitlement documented in
> [`classroom-attendance-qr.md`](../../classroom-attendance-qr.md). This file is
> retained only as historical design evidence and is not an active control.

- Surface/reference: existing teacher Daily More actions and classroom poster
  dialog, plus Pattern Lab Controls QR example. This is conditional availability,
  not a redesign or new shared pattern.
- Roles: teacher menu/poster, student existing closed-state feedback.
- Matrix: desktop 1440×900 and mobile 390×844, light/dark; teacher allowed poster
  and gated menu, existing occurrence QR; student closed/invalid/eligible fixtures.
- Primary signal: presence or absence of the existing poster menu item. No new
  copy, badges, layout, colors, animation or persistent instruction panels.
- Reuse: existing classroom poster dialog and student feedback; extend Daily's
  feature-owned availability prop. No shared primitive API changes.
- Composite checklist reviewed: shared menu keyboard navigation and Escape/focus
  return remain; semantic tests cover availability, and browser checks cover gated
  menu Escape/focus. No experimental pattern or human design promotion is needed.
- Historical behavior: the gate was authoritative server-side and the UI received
  only a boolean, not configured canary identifiers or credentials.
- Capture provenance and verification results belong in the correction PR. Local
  fixture evidence does not satisfy the live Pika-to-Bara production canary gate.
