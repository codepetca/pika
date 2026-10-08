# Settings clipboard feedback

Teacher Settings / Access, including its existing join QR dialog. Approved references: real TeacherSettingsTab controls and the Pattern Lab status-colour catalog and Settings mockup; canonical AppMessage provider source. Teacher desktop/mobile, light/dark, normal/reduced motion; student n/a because no student copy owner changes. States: copy pending, rejected, unavailable, successful retry, superseded request, committed classroom replacement, unmount; QR open/close/focus. Primary signal: concise textual success or warning in the existing polite live message pill. No new controls, shared message API, save behavior, or instruction paragraph. QR feedback overlays the existing dialog boundary without changing control geometry.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Truthful feedback | AppMessageProvider/useAppMessage | reuse | Existing success/warning tones and guarded clear-by-id contract |
| Copy actions | Button and current Access/QR controls | reuse | Preserve targets, focus and explicit retries |
| QR copy feedback | TeacherClassroomJoinQrDialog | extend | Feature-owned polite status stays inside the active dialog, preserving existing Escape/backdrop timing and focus return |
| Copy request ownership | TeacherSettingsTab copy handler | extend | Guard completion by committed owner and latest request, without altering settings save ownership |

No experimental shared pattern or promotion needed. Composite accessibility checklist reviewed; native verification will cover focus retention, live warning, keyboard copy and QR focus return. Pending clipboard writes cannot be cancelled; only their feedback is retired. Same-classroom refresh does not reset drafts.

Evidence retained externally under product-fluidity/settings-copy-feedback, frozen base a86a20930e126cf40a245dc3933d39826ec15f82.
