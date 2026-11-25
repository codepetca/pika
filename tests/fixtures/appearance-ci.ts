// Stable contract inputs: real appearance edits must never rewrite their own
// expected eligibility by changing the checkout used to run these tests.
export const cssPath = 'src/styles/tokens.css'
export const pagePath = 'src/app/join/page.tsx'
export const copy = 'Enter the join code your teacher gave you.'
export const css = `:root {
  --color-calendar-announcement: #8d2b13;
  --color-calendar-announcement-bg: #ffc0a6;
  --color-calendar-announcement-hover: #abcdef;
  --color-primary: #1d4ed8;
  --color-calendar-resource: #5c626e;
  --space-dialog: 1.25rem;
}
.dark {
  --color-calendar-announcement: #fedcba;
  --color-calendar-announcement-bg: #123456;
  --color-calendar-announcement-hover: #654321;
}
`
export const page = `'use client'
export default function JoinPage() {
  const code = ''
  function submit(e: React.FormEvent) { e.preventDefault() }
  return <div>
    <h1>Join a classroom</h1>
    <p className="text-text-muted mt-2">${copy}</p>
    <form onSubmit={submit}><Input label="Join code" value={code} /></form>
  </div>
}
`
