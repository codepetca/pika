# Microsoft Clarity eligibility inquiry — prepared, not sent

Status: draft external inquiry only. Prepared 2026-10-08. Do not send without the
Pika maintainer's approval. Record any response with its date, sender/support channel,
and complete context; a generic sales answer or AI-generated Q&A is not an eligibility
decision for this deployment.

To: `clarityMS@microsoft.com`

Subject: Eligibility confirmation for an adult-teacher-only pilot in a mixed-age education app

Hello Microsoft Clarity Support,

We operate Pika, an authenticated classroom application used in adult education and
other education settings. Some learners who can access the application may be under 18.
Your FAQ says that Clarity should not be used on websites or apps targeting users under 18.

We are considering a narrowly limited pilot with these controls:

- the Clarity script would load only for a named cohort of verified adult teachers who
  explicitly opt in;
- the server would confirm that the current user is the owner/teacher for the specific
  classroom before the script can load;
- collection would be limited to teacher assignment-authoring surfaces;
- the script would never load for learner/member sessions, unknown-age users, public or
  authentication pages, student previews, tests or exam mode, grading, rosters,
  submissions, feedback, or other student-record surfaces;
- the pilot would use a separate Clarity project, strict content masking, no direct
  identifiers or educational content in custom data, and `ad_Storage` denied.

Please confirm in writing:

1. Does the under-18 restriction permit this technically isolated adult-teacher-only
   deployment within one mixed-audience application and domain, or does any availability
   of the application to under-18 learners make the entire app/domain ineligible?
2. If it is permitted, is same-domain server-gated script loading sufficient, or must the
   eligible teacher workflow use a separate hostname or application boundary?
3. Are there additional Clarity terms, project settings, contractual steps, or technical
   controls required for this exact use case?

We will not create a tracking project, install the script, or collect pilot data until
this eligibility question and our own privacy review are resolved.

Thank you.
