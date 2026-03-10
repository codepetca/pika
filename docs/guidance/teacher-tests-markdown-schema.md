# Teacher Tests Markdown Schema

This schema defines the markdown format used by Pika's teacher test editor (`Markdown` tab) for creating/updating a single test.

## Top-level Structure

```md
# Test                          # [Optional]
Title: <non-empty string>       # [Required]
Show Results: <boolean>         # [Optional] true|false|yes|no|1|0

## Questions                    # [Required]
### Question 1
...

### Question 2
...

## Documents                    # [Optional]
_None_
```

Rules:
- `## Questions` is required.
- `Title` is required.
- `Show Results` is optional. If omitted, existing/current value is used.
- `# Test` is optional.
- Field keys are case-insensitive (`Title`, `title`, etc).

## Question Block Schema

Each question must be in its own `### Question N` block.

Fields:
- `ID` — [Optional] UUID
- `Type` — [Optional] `multiple_choice` or `open_response`
- `Points` — [Optional] number, must be `> 0`
- `Prompt` — [Required] multiline text
- `Options` — [Required for `multiple_choice`]
- `Correct Option` — [Required for `multiple_choice`] 1-based integer
- `Code` — [Optional for `open_response`] boolean
- `Max Chars` — [Optional for `open_response`] integer `1..20000`
- `Answer Key` — [Optional for `open_response`] multiline text

Defaults:
- `Type`: `multiple_choice`
- `Points`:
  - `multiple_choice`: `1`
  - `open_response`: `5`
- `Code`: `false`
- `Max Chars`: `5000`
- `ID`: keeps existing question ID at same index when available; otherwise generates a UUID.

Validation:
- At least 1 question is required.
- `Prompt` cannot be empty.
- `multiple_choice`:
  - at least 2 options, max 6 options
  - `Correct Option` is required
  - `Correct Option` must reference a valid option index (1..option_count)
- `open_response`:
  - `Answer Key` optional (if present, must be <= 20000 chars)

## Documents Block Schema

`## Documents` is optional:
- If omitted entirely, existing documents are preserved.
- To clear all documents, include:

```md
## Documents
_None_
```

Each document must be in its own `### Document N` block.

Fields:
- `ID` — [Optional] UUID
- `Source` — [Optional] `link`, `upload`, `text` (default: `link`)
- `Title` — [Required] non-empty string
- `URL` — [Required for `link` and `upload`] must be `http://` or `https://`
- `Content` — [Required for `text`] multiline text

Validation:
- Maximum 20 documents.
- `ID` is required after normalization (existing ID fallback or generated UUID).
- Invalid documents cause markdown apply to fail.

## Copy-Paste Template

```md
# Test                            # [Optional]
Title: <Test Title>               # [Required]
Show Results: false               # [Optional]

## Questions                      # [Required]
### Question 1
Type: multiple_choice             # [Optional]
Points: 1                         # [Optional]
Prompt:
<Question prompt>                 # [Required]
Options:
- <Option 1>
- <Option 2>
Correct Option: 1                 # [Required for multiple_choice]

### Question 2
Type: open_response               # [Optional]
Points: 5                         # [Optional]
Code: false                       # [Optional for open_response]
Max Chars: 5000                   # [Optional for open_response]
Prompt:
<Open response prompt>            # [Required]
Answer Key:
<Optional answer key>             # [Optional for open_response]

## Documents                      # [Optional]
_None_
```

## Valid Example

```md
# Test
Title: Unit 1 Checkpoint
Show Results: true

## Questions
### Question 1
Type: multiple_choice
Points: 2
Prompt:
What is 2 + 2?
Options:
- 3
- 4
- 5
Correct Option: 2

### Question 2
Type: open_response
Points: 5
Code: true
Max Chars: 3000
Prompt:
Explain polymorphism in one paragraph.
Answer Key:
Any accurate explanation of one interface with multiple implementations.

## Documents
### Document 1
Source: link
Title: Java API
URL: https://docs.oracle.com/en/java/

### Document 2
Source: text
Title: Allowed formulas
Content:
distance = rate * time
```
