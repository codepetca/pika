# Gradebook explicit-retry focus

Surface: teacher Gradebook cold/warm required-read recovery. Reference: accepted native Roster Retry→named Classroom roster region, existing desktop Gradebook students region, and executable `/pattern-lab#page-states` captured before implementation. Stable PageState and DESIGN focus contracts apply.

Roles: teacher; student n/a (teacher-only owner). Desktop/mobile, light/dark, normal/reduced motion. States: failed read, keyboard Retry, pending retry, successful populated/empty read, inactive/classroom-changed late read, resized presentation. Primary signal: existing governed focus ring on the visible work region. No new action/control, data behavior, request/cache/mutation change or shared primitive.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Failed/pending read and Retry | Existing PageState/Gradebook Retry | reuse | Existing semantics and keyboard behavior fit. |
| Desktop retry handoff | Gradebook students region | reuse | Preserve named table focus and scroll. |
| Mobile retry handoff | Existing compact Gradebook workspace | extend | Name/focus the visible feature-owned region when hidden desktop cannot receive focus. |
| Focus treatment | Governed named region focus classes | reuse | Existing semantic foundation ring; no new visual pattern. |

Composite accessibility review: yes, explicit Retry keyboard handoff; pending focus stays on Retry. Successful explicit retry alone moves focus. Initial/background reads do not. Inactive/current-classroom guards prevent late reads stealing focus; actual focus receipt chooses responsive presentation rather than duplicating CSS breakpoints. Local native helper must prove all four theme/view pairs × normal/reduced motion; controlled45 students/zero assessments, no database persistence. Unit tests cover fallback, empty success, inactive and stale-classroom guards; native coverage owns CSS-hidden behavior.

Visual refinement: paint the governed inset ring on a feature-local pointer-transparent pseudo-element above the compact workspace children; their surfaces otherwise cover its shadow. Desktop ring owner is unchanged.
