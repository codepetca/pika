---
status: experimental
scope: generic-modal-visual-dismissal
source_files:
  - src/ui/ModalLayer.tsx
  - src/ui/Dialog.tsx
  - src/app/__ui/DialogEntryPattern.tsx
human_review_required: true
---

# Experimental generic modal exit adoption

The [bounded dismissal phase](../changes/softer-modal-dismissal.md) extends the canonical owner with an explicit opacity-exit opt-in. Its exact duration and easing belong to semantic tokens. The real Pattern Lab dialog comparison provides executable evidence; it does not promote all generic callers into the stable UI canon.

A passive visual exit may remain after logical close only when focus, stack membership, keyboard handling, background isolation, scroll and feature commands have already updated. It must be inert, aria-hidden and pointer-disabled, and reduced motion must remove the retention. Rapid reopening cancels old cleanup and uses the current open presentation.

Opacity presence retains React descendants. Before applying it to ContentDialog, DialogPanel or a custom ModalLayer, verify their effect/request/editor/widget cleanup and last-open content. Preserve parent close invalidation immediately. A conditionally removed parent cannot be covered by child presence. Rich editors and live widgets require individual evidence; a static-looking body is not proof that it is effect-free.

The static alert/confirmation rollout does not establish wider generic adoption. Do not introduce DOM clones, duplicated renderers or a second overlay owner as incidental fixes. Later adoption needs real caller tests, immediate lifecycle evidence, both-role responsive/theme/motion captures and explicit human promotion of the broader guidance.
