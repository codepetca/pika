# Java explained lesson site

Future lessons should follow the [lesson viewer guide](../../../lesson-viewer-guide.md) and reuse this viewer format.

This standalone curriculum artifact does not change Pika's application UI, shared components, database schema, or authentication. Product runtime risk: none. Current GPT model handles the bounded lesson editing and direct verification.

The editable student source is `../01-java-explained.md`. Teaching notes live in `../teacher-notes.md` and are excluded from the generated site.

Run from this directory:

```sh
node build.mjs
python3 -m http.server 4317 --directory dist
```

Open http://localhost:4317. The viewer has no header or previous/next buttons. Its footer holds the page count, Read/Present icon toggle (book/screen), fullscreen icon, and a three-dot menu with Light/Dark, Print lesson, presenter notes, and Markdown download. Arrow keys and Page Up/Down navigate presentations; Escape returns to reading. Appearance is remembered on the device. Read places a compact version of the matching presentation diagram below each section heading, followed by its detailed explanations. Presenter notes use this same reading layout. Present fills the available desktop viewport above the footer, without a fixed width cap, and uses larger titles, symbols, and labels. Read diagrams retain their compact size. CSS and JavaScript URLs include content hashes so rebuilt assets refresh reliably. Present uses nine matching diagrams with short labels; each section selects its diagram using a visual fence in the Markdown. Diagram templates live in visuals.mjs. Who does what uses a game controller icon for Program, with matching reading and mobile variants. Compile and Explain the journey use a matching factory icon for the compiler, including their reading and mobile diagrams. The downloaded student Markdown omits those visual directives. Open presenter’s notes in the three-dot menu to open a separate reading window; it follows the active slide, and its Arrow/Page keys can control the presentation. Window placement follows the browser’s popup preferences. Synchronization uses an ephemeral same-origin BroadcastChannel for this presentation session. Print prints the entire lesson even when presentation mode shows one section. The Markdown download contains only the student lesson.

The small renderer supports paragraphs, bold, inline code, bullet lists, quotes, code fences, and two diagram fence types: flow and platforms. It escapes HTML and has no external dependencies. Each second-level Markdown heading becomes a presentation section. Edit the Markdown, rebuild, and republish together.

Publish only generated dist assets. A separate Sites source checkout contains a copy of the student Markdown, build source, and generated files. Never copy the whole Pika repo, environment files, or teacher notes into it. Sites deployment identity belongs to that checkout's .openai/hosting.json.

Student release approved and completed on 2026-10-02. Site access is public (anyone with the URL); Pika Material is posted in P3 - ICS3U. Preserve this audience on future updates; use save_site_version then deploy_site_version rather than the owner-private deployment operation.

Hosted student lesson: https://ics3u-java-explained.stewchan.chatgpt.site

Sites project: appgprj_6abfba35d1488191a95161dc1d5353a6

Published source commit: 68c563f63a627b20e7111ccd8d869c85641e7ce0

Published version: appgprj_6abfba35d1488191a95161dc1d5353a6~appgver_b856dce49cb08191ba15841e9f27ca94

The initial publication used an exact Git source push and committed-asset archive when the bundled Sites helper was unavailable. The helper is available again; updates use its normal source-opening and publication workflow. The latest update used ordinary save/deploy to preserve the public student audience. No credentials were stored in the source.

Pika Material Java Explained (originally 1.1 Java explained) is Posted in P3 - ICS3U, classroom 0a103a76-2b60-4fb6-8158-4a97727bd35f. Verified the Posted badge after reloading and reopening. The clickable link points to the public student lesson; an unauthenticated request returned HTTP 200 with all nine sections and diagrams. The local posted-content mirror is ../material.json.

Java Explained was added to the linked ICS3U-4 Blueprint on 2026-10-02. Exporting the course package saved Blueprint Version 5 from Draft revision 6; both the saved version and Material were verified after reloading. Future classrooms created from that version inherit the lesson link. The portable Material is mirrored in [blueprint-material.md](../blueprint-material.md), with Artifact ID 8ad9cfa1-1c8e-4733-a16f-90cbc0a35111 and Classwork Position 15. This appends the Material after existing blueprint classwork. Existing classrooms retain their own content/version until explicitly updated.

Both P3 - ICS3U and P5 - ICS3U use this same ICS3U-4 Blueprint. On 2026-10-02, Java Explained was verified Posted in both classrooms; P5's Material links to the same public lesson site. P5 classroom ID: 4509e56f-2cb8-461f-b205-88faf6fa7d88. Both classroom Blueprint tabs still show Content Version 3 and Guidance Version 4. The owner confirmed updating both frozen classroom Blueprint snapshots. Pika blocks preparation with "Save or reconcile new classroom artifacts with this Blueprint before preparing a classroom update"; no classroom update was applied.

Read-only reconciliation review found local Unit 1 tests in both classrooms, a P3 verification test, and a P5 verification assignment, alongside the local Java Material. Current promotion controls select whole areas: Tests replaces the reusable test set, Lesson Plans replaces the lesson sequence, and Materials replaces the material set using the classroom artifact ID. Promoting Java alone would not clear the unrelated-artifact gate. No reconciliation proposal or unrelated promotion was saved. A scope decision is pending between a targeted-update application fix, broader course reconciliation, and retaining the current classroom snapshots. The shared reusable Blueprint and both Posted student Materials already include Java Explained.
