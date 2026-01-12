---
name: secret-scan
trigger: pre-commit, post-edit
description: Scans for accidentally exposed secrets, API keys, and credentials
enabled: true
blockOnDetection: true
---

**Purpose:** Prevent credential leaks in commits.

**Patterns Detected:**

| Pattern | Example |
|---------|---------|
| API Keys | `sk-...`, `pk_live_...`, `AKIA...` |
| Private Keys | `-----BEGIN RSA PRIVATE KEY-----` |
| Passwords | `password = "..."`, `pwd: "..."` |
| Tokens | `ghp_...`, `gho_...`, `Bearer ...` |
| Connection Strings | `mongodb+srv://user:pass@...` |
| AWS Credentials | `AKIA...`, `aws_secret_access_key` |

**Behavior:**

```
ON pre_commit OR post_edit:
  SCAN file for_secret_patterns
  
  IF secrets_found:
    BLOCK operation
    ALERT user
    SUGGEST remediation
```

**Commands:**

```bash
# Manual scan
grep -rn "API_KEY\|SECRET\|PASSWORD\|PRIVATE_KEY" --include="*.ts" --include="*.tsx" --include="*.env"

# Exclude test files
grep -rn "API_KEY" --include="*.ts" --exclude="*.test.ts"
```

**Output (Clean):**

```markdown
✓ No secrets detected in `src/api/client.ts`
```

**Output (Detection):**

```markdown
🚨 SECRETS DETECTED - COMMIT BLOCKED

## Findings
| File | Line | Type | Risk |
|------|------|------|------|
| src/api.ts | 15 | API Key | HIGH |
| lib/config.ts | 42 | Password | HIGH |

## Details
**src/api.ts:15**
```tsx
const API_KEY = "sk-abc123..." // ← Exposed secret
```

## Remediation
1. Remove the secret from code immediately
2. Use environment variables instead:
   ```tsx
   const API_KEY = process.env.API_KEY
   ```
3. Add to `.env.local` (gitignored):
   ```
   API_KEY=sk-abc123...
   ```
4. If already committed, rotate the credential

## Files to Check
- `.env` files should be gitignored
- Use `.env.example` for templates (no real values)
```

**Allowlist:**

For false positives, add to `.secretsignore`:
```
# Allow test fixtures
tests/fixtures/mock-credentials.ts

# Allow documentation examples  
docs/api-example.md
```
