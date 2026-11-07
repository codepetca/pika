# Parent gradebook PDF refinement

Surface: downloadable individual student gradebook report, generated from the teacher Gradebook; the reader is a parent or guardian. The teacher Gradebook assessment labels and the stable Pika typography and scan hierarchy are the reference. Pattern Lab's interactive controls do not own printed PDF composition; this is a document-specific extension of the existing report generator, not a new shared control.

Primary signal: a prominent current grade with student, course and generated-date context, followed by clearly separated assessment entries. Classwork and tests appear only after return, and saved Gradebook marks may also appear. It does not disclose unreleased work or other students. Empty, single-assessment, long/multilingual and multi-page reports are relevant states. Print is a single light letter-sized layout, so app viewport, app theme, student application view, and composite-widget interaction are not applicable. The teacher export menu remains unchanged.

Assessment rows place the title and percentage on the first line, followed by the type and category with the raw score on the second. Fifteen typical assessments fit on one page; long labels and additional status lines may require more pages. Long labels wrap within the remaining width; their marks align with the last label line so the full text remains together in reading order. Excluded assessments retain their explanatory status below the row.

| Need | Existing candidate | Decision | Reason |
|---|---|---|---|
| Eligible marks and calculations | Gradebook student report projection | reuse | Preserves returned-work, weighting and privacy rules. |
| Multilingual PDF text and archive | Existing PDF report generator | extend | Retains embedded fonts, safe wrapping and separate recipient manifest. |
| Interactive layout primitives | Pika UI and Pattern Lab | reuse | The existing export control is unchanged; print layout has no interactive widget. |

Verification: render and inspect short, empty, multilingual and multi-page PDFs; check extracted text and pagination; exercise the export through the teacher Gradebook in a browser. Student interface, responsive breakpoints and dark mode are not applicable to the document itself.
