# Editor overlay motion

Refine the existing rich-text toolbar dropdown and popover owners. Reference:
Pika's fast opacity entry and immediate command dismissal, governed by DESIGN.md
and src/ui/README.md. Pattern Lab's teacher `markdown-authoring` composition and
student `student-image-upload` composition render the actual affected owners.
Their existing imports exercise this change; no separate lookalike is added.

| Need | Existing candidate | Decision | Reason |
| --- | --- | --- | --- |
| Entry | Semantic fast duration, standard easing, opacity | reuse | Stationary text and consistent pacing |
| Overlay styling | Tiptap dropdown/popover SCSS owners | extend | Covers production toolbar adopters, including Markdown Format |
| Dismissal and focus | Existing Radix and editor callbacks | reuse | Live commands and focus ownership retire immediately |

Primary signal: opacity only. Do not add translation, zoom, delayed commands,
retained live forms, a second focus owner, dependencies or backend operations.
Stable foundation guidance is followed; no new experimental pattern or promotion.

The existing side selectors override state animations. Their identical open and
closed animation names currently cause immediate Radix removal. Distinct exit
animation names would instead retain live commands and postpone unmount focus
callbacks. Keep closed animation `none`; visible exit is outside this pass.

Verification matrix: teacher/student; desktop/mobile; light/dark; normal/reduced
motion and live preference changes. Check opacity interpolation with stationary
text, top/bottom placements, keyboard navigation, Escape/outside/command close,
rapid reopen, editor identity/selection and Markdown Format focus return.
Desktop Link uses the popover; mobile Link uses its existing toolbar subview.
No network writes or external link activation are required.

Composite widget checklist: required. Preserve accessible roles/names, expanded
state, native focus callbacks, keyboard behavior and disabled items. Reuse the
existing editor semantic tests and run native interaction/visual checks on the
actual Pattern Lab owners. Screenshots are evidence of presentation; browser
assertions establish motion and immediate command removal.
