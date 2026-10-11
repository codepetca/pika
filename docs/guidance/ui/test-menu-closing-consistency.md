# Actual Test Question actions closing consistency

Surface: the production split-layout Question actions menu in TestDetailPanel, rendered by TeacherTestAuthoringDialog. The plain MC/Open SplitButton belongs to inactive alternate layouts and is excluded.
Reference: existing actual Test Question actions icons/composition and TeacherWorkSurfaceActionCluster; shared SplitButton/Material/Assignment semantic-fast quiet opacity, immediate logical dismissal, reduced-motion and command/focus lifetime fences.
Roles: teacher for actual Test authoring; student n/a for that controller. The changed shared navigation hook also receives fresh teacher/student UserMenu compatibility verification.
Viewports/themes: desktop1440x900 and mobile390x844; light/dark and normal/reduced motion (8 actual Test contexts). Six named held-save handoffs cover Close/Publish/Preview in desktop/light/normal and mobile/dark/reduced. Four UserMenu compatibility contexts cover both roles in those two representative settings, including theme, native keyboard and Feedback focus return; no feedback sending or logout mutation.
States: closed/open, keyboard focus, natural dismissal/rapid reopen, owner replacement/classroom/API/loading/missing/unmount, same-ID summary/editor preservation, structural lock, dirty Markdown, pending Close/Publish/Preview.
Primary signal: existing icon menu and quiet semantic-fast opacity dismissal.
Must not add: new motion primitives/dependencies, removed icons, arbitrary retained React children/HTML/SVG cloning, new structural/publication authority, whole-panel keys, altered question insertion/autosave/flush, dormant chooser adoption, production writes.
Composite widget accessibility review: yes; hydrated current trigger/menu IDs, roving keys, immediate command retirement, inert aria-hidden presentation and cancelled stale focus work.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Timing and dismissal rules | Shared SplitButton/Material closing | reuse | Existing semantic fast easing, immediate logical close and reduced-motion behavior. |
| Icon-bearing menu presentation/lifetime | TeacherWorkSurfaceActionCluster owner | extend | Optional opacity and interactionActive; default immediate; copy primitive fields and audited known Lucide icon kinds into fresh static presentation. |
| Actual Test identity/readiness | Split Question actions owner | extend | Key only menu by existing test/classroom/API scope; use existing committed scope/loading/handoff busy state. |
| Real controller verification | Pattern Lab explicit controller gate | extend | Fixed real TeacherTestAuthoringDialog/TestDetailPanel fixture with exact intercepted transport. |
| Business behavior | Existing split question insertion/autosave/flush | reuse | Preserve flush, immediate insertion, selection, summary merges, versions and server structural policy. |

Implementation preserves canonical useDropdownNav ownership. Additive interaction/readiness and committed cancellation guards in the hook keep defaults compatible; the existing menu owner adds current-command/generation and static presentation fences. Verify unrelated hook adopters and default keyboard/hydration/tooltip/hover behavior. Its optional fade retains no callbacks, arbitrary label/description nodes, or caller React icon instances. Primitive labels/descriptions and exact audited Plus/Code2/Copy/Trash2 icons may produce copied static fields; unsupported props/ref/children/custom icons fall back to immediate removal. Closing presentation remains conservative on incoming items-array change, owner/availability changes and unmount. No new stable component or promotion.

Ordinary dismissal attempts zero mutations. Named business cases count real synthetic PATCH payload/version acknowledgements separately: actual add-question autosave, forced clean Close/Preview/Publish and unsaved unmount. Unknown APIs fail; no backend writes. Record real fullscreen outcome; callback alone cannot prove preview modal focus. Native matrix plus real-panel/shared-owner regressions, gallery gates, focused/audit/static, unchanged Pattern Lab goldens and coordinator visual inspection precede independent stable-SHA review/PR Gate/main landing. No product-wide completion claim. Existing rich document/dormant menus remain excluded.
