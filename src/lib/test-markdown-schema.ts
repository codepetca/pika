export const TEST_MARKDOWN_TOP_LEVEL_STRUCTURE = `# Test                          # [Optional]
Title: <non-empty string>       # [Required]
Show Results: <boolean>         # [Optional] true|false|yes|no|1|0

## Questions                    # [Required]
### Question 1
...

### Question 2
...

## Documents                    # [Optional]
### Document 1
...`

export const TEST_MARKDOWN_AI_SCHEMA = `# Test                            # [Optional]
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
### Document 1                    # [Optional]
Source: link                      # [Optional] link|upload|text
Title: <Document Title>           # [Required]
URL: https://example.com/doc      # [Required for link/upload]

### Document 2                    # [Optional]
Source: text                      # [Optional]
Title: <Reference Notes>          # [Required]
Content:
<Paste reference text here>       # [Required for text]

### Document 3                    # [Optional]
Source: upload                    # [Optional]
Title: <Uploaded File Title>      # [Required]
URL: https://example.com/file.pdf # [Required for upload]

# To clear all documents instead, use:
# ## Documents
# _None_`
