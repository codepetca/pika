# Classic auth submit failure feedback

Anonymous Login, Signup, Verify Signup, Create Password, Forgot Password and both
Reset Password stages reuse the accepted auth `FormField reserveErrorSpace` alert
owner and `useAuthFormContinuity`. Pattern Lab base form controls remain the
executable reference. Teacher/student views are n/a: these routes precede role
selection. The shared primitive contract is unchanged; no Pattern Lab extension
is needed.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Inline live failure feedback | FormField reserved error slot | reuse | Preserve semantics and geometry |
| Pending, focus and lifetime | useAuthFormContinuity | reuse | Preserve request ownership and recovery |
| Boundary failure copy | auth-submit-response feature helper | create | Seven submit stages share narrow classification |

Primary signal: readable inline failure text. Verify malformed JSON, network
failure, intentional server validation and successful retry on actual routes at
1440, 390 and 320px, light/dark, normal/reduced motion. Preserve node/value/caret,
focus ownership, busy states, reserved space and live feedback. No new styling,
controls, auth/session/security behavior, timers, navigation or storage policy.
WorkOS restore, MagicAuthForm and resend are excluded. No composite widget is
introduced; existing form label/error association and keyboard checks apply.

Only fetch TypeError transport failures and response.json SyntaxError failures
receive readable copy. Valid server messages and successful response data retain
their existing handling. Abort and unrelated exceptions retain their identity.
