# Assignment Markdown Schema

AI-generated course-blueprint assignments use this flat markdown shape:

```markdown
## Build and Deploy [DRAFT]
Due Days: 7
Due Time: 23:59
Points: 30
Include In Final: true

Ship a small app and submit the required evidence.

### Submission Requirements
- repo_link | Repo link | required | Use your public GitHub repository.
- link | Public link | required | Paste the deployed project or demo URL.
- image | Screenshot | optional | Upload a screenshot of the working app.
---
```

Requirement type must be one of `repo_link`, `link`, or `image`. The third column is `required` or `optional`; the fourth column is student-facing helper text.
