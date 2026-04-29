# TLDR Cheatsheet

When `llm-tldr` is installed (v1.5+), prefer TLDR for large codebases. Language is auto-detected across 17 languages — no need to specify `--lang`.

cc-settings starts the TLDR daemon on `SessionStart` and notifies it on every Write/Edit, so queries hit a hot in-memory index (~100 ms) instead of cold-spawning the CLI (~30 s). Check daemon health with `tldr daemon status`.

| Instead of... | Use |
|---|---|
| Reading a large file | `tldr context functionName --project .` |
| Searching by meaning | `tldr semantic "description" .` |
| Finding callers | `tldr impact functionName .` |
| Forward import graph | `tldr imports <file>` |
| Reverse import lookup | `tldr importers <module> .` |
| Architecture overview | `tldr arch .` |
| File tree | `tldr tree .` |
| Dead code | `tldr dead .` |
| Tests affected by changes | `tldr change-impact --project .` |
| Type + lint diagnostics | `tldr diagnostics <file>` |
| Control / data flow / slice | `tldr cfg`, `tldr dfg`, `tldr slice` |

Use TLDR when it saves tokens. Use Read/Grep when you need exact content or small files.
