# Security Reference Material

Detection patterns, vulnerability examples, and Darkroom-specific security checks for the `security-reviewer` agent.

---

## OWASP Top 10 Coverage

### 1. Injection (A03:2021)

**SQL/NoSQL Injection**
```bash
# Find raw query construction
rg "query\s*\(" --type ts -A 3
rg "\.raw\s*\(" --type ts
rg "\$\{.*\}" --type ts -g "*.sql"
rg "db\.(execute|query)" --type ts -A 2
```

**Command Injection**
```bash
# Find shell execution
rg "(exec|spawn|execSync|spawnSync)\s*\(" --type ts
rg "child_process" --type ts
rg "\`.*\$\{" --type ts  # Template literals in shell commands
```

**XSS (Cross-Site Scripting)**
```bash
# Find dangerous HTML insertion
rg "dangerouslySetInnerHTML" --type ts
rg "innerHTML\s*=" --type ts
rg "\.html\s*\(" --type ts
rg "document\.write" --type ts
```

### 2. Broken Authentication (A07:2021)

```bash
# Weak session handling
rg "jwt\.sign" --type ts -A 5  # Check expiry settings
rg "session" --type ts -g "*.config.*"
rg "cookie" --type ts -A 3  # Check httpOnly, secure flags

# Hardcoded credentials
rg "(password|secret|token)\s*[=:]\s*['\"]" --type ts -i
rg "Bearer\s+[A-Za-z0-9\-_]+" --type ts
```

### 3. Sensitive Data Exposure (A02:2021)

```bash
# Find logging of sensitive data
rg "console\.(log|info|debug).*password" --type ts -i
rg "console\.(log|info|debug).*token" --type ts -i
rg "console\.(log|info|debug).*secret" --type ts -i
rg "console\.(log|info|debug).*key" --type ts -i

# Find PII in responses
rg "res\.(json|send).*email" --type ts
rg "res\.(json|send).*phone" --type ts
```

### 4. Broken Access Control (A01:2021)

```bash
# Missing authorization checks
rg "export (async )?function (GET|POST|PUT|DELETE|PATCH)" --type ts -A 10
rg "api/.*route\.(ts|js)" --type ts
# Look for routes without auth middleware

# Direct object reference
rg "params\.(id|userId|orderId)" --type ts -A 5
rg "searchParams\.get" --type ts -A 3
```

### 5. Security Misconfiguration (A05:2021)

```bash
# Debug mode in production
rg "NODE_ENV.*development" --type ts
rg "debug\s*:\s*true" --type ts
rg "verbose\s*:\s*true" --type ts

# CORS misconfiguration
rg "Access-Control-Allow-Origin.*\*" --type ts
rg "cors\(" --type ts -A 5
```

### 6. Vulnerable Components (A06:2021)

```bash
# Check for known vulnerable patterns
bun audit  # Run dependency audit
rg "eval\s*\(" --type ts
rg "new Function\s*\(" --type ts
rg "setTimeout.*string" --type ts
rg "setInterval.*string" --type ts
```

### 7. Identification Failures (A07:2021)

```bash
# Weak crypto
rg "md5|sha1" --type ts -i
rg "Math\.random" --type ts  # Not cryptographically secure
rg "crypto\.createHash\(['\"]md5" --type ts
```

### 8. Data Integrity Failures (A08:2021)

```bash
# Unsafe deserialization
rg "JSON\.parse" --type ts -B 2 -A 2  # Check for validation
rg "deserialize|unserialize" --type ts
rg "yaml\.load" --type ts  # Unsafe YAML parsing
```

### 9. Logging Failures (A09:2021)

```bash
# Missing security logging
rg "catch\s*\(" --type ts -A 3  # Check error handling
# Verify auth events are logged
rg "(login|logout|auth)" --type ts -A 5
```

### 10. SSRF (A10:2021)

```bash
# Server-side request forgery
rg "fetch\s*\(" --type ts -A 2
rg "axios\.(get|post)" --type ts -A 2
rg "http\.request" --type ts -A 2
# Check if URLs are user-controlled
```

---

## Secret Detection Patterns

### High-Severity (Block Merge)

```bash
# API Keys & Tokens
rg "AKIA[0-9A-Z]{16}" .                          # AWS Access Key
rg "sk-[a-zA-Z0-9]{48}" .                         # OpenAI API Key
rg "sk_live_[a-zA-Z0-9]{24,}" .                   # Stripe Live Key
rg "sk_test_[a-zA-Z0-9]{24,}" .                   # Stripe Test Key
rg "ghp_[a-zA-Z0-9]{36}" .                        # GitHub PAT
rg "gho_[a-zA-Z0-9]{36}" .                        # GitHub OAuth Token
rg "glpat-[a-zA-Z0-9\-]{20}" .                    # GitLab PAT
rg "xox[baprs]-[a-zA-Z0-9\-]+" .                  # Slack Token
rg "shpat_[a-fA-F0-9]{32}" .                      # Shopify Admin Token
rg "shpss_[a-fA-F0-9]{32}" .                      # Shopify Storefront Token
rg "sanity[a-zA-Z0-9]{24}" .                      # Sanity Token (approx)

# Private Keys
rg "-----BEGIN (RSA |EC |DSA )?PRIVATE KEY" .
rg "-----BEGIN OPENSSH PRIVATE KEY" .
rg "-----BEGIN PGP PRIVATE KEY" .

# Connection Strings
rg "mongodb(\+srv)?://[^/\s]+" .
rg "postgres(ql)?://[^/\s]+" .
rg "mysql://[^/\s]+" .
rg "redis://[^/\s]+" .

# Generic Secrets
rg "(api[_-]?key|apikey)\s*[=:]\s*['\"][a-zA-Z0-9]{16,}['\"]" . -i
rg "(secret|token|password|passwd|pwd)\s*[=:]\s*['\"][^'\"]{8,}['\"]" . -i
```

### Medium-Severity (Warning)

```bash
# Potentially sensitive values
rg "Authorization:\s*Bearer" . --type ts
rg "x-api-key" . --type ts -i
rg "client_secret" . --type ts
rg "refresh_token" . --type ts
```

### Files to Always Check

```bash
# Should never contain secrets
# NOTE: Only scan git-tracked files. Files like .env.local, .env.development.local,
# etc. are gitignored by convention and should NOT trigger alerts.
rg -l "." --type ts -g "*.config.*"
rg -l "." -g ".env*" -g "!.env.example" -g "!.env.local.example" -g "!.env.local" -g "!.env*.local"
rg -l "." -g "*.json" -g "!package*.json" -g "!tsconfig*.json"

# Preferred: Only scan files tracked by git to avoid false positives
git ls-files -- '.env*' ':!.env.example' ':!.env*.example' | xargs -r rg -l "."
```

---

## Darkroom-Specific Security Checks

### Shopify Commerce Security

```bash
# Storefront API exposure
rg "X-Shopify-Storefront-Access-Token" --type ts
rg "storefrontAccessToken" --type ts -A 3

# Admin API misuse (should never be client-side)
rg "X-Shopify-Access-Token" --type ts  # Should not be in .tsx files
rg "shpat_" --type ts                   # Admin tokens in frontend

# Checkout security
rg "checkoutCreate|checkoutComplete" --type ts -A 5
# Verify price/inventory is validated server-side

# Webhook validation
rg "shopify.*webhook" --type ts -i -A 10
# Must verify HMAC signature
```

**Shopify Security Checklist:**
- [ ] Storefront token is public-safe (read-only scope)
- [ ] Admin API calls are server-side only
- [ ] Webhooks verify HMAC signature
- [ ] Checkout prices validated server-side
- [ ] Customer data not exposed to client
- [ ] Rate limiting on API routes

### Sanity CMS Security

```bash
# Token exposure
rg "sanity.*token" --type ts -i -A 3
rg "SANITY_API_TOKEN" --type ts  # Should not be in frontend

# Dataset access
rg "dataset.*production" --type ts -A 3
# Verify write access is restricted

# GROQ injection
rg "\*\[.*\$\{" --type ts  # User input in GROQ queries
rg "groq`.*\$\{" --type ts

# CDN security
rg "cdn\.sanity" --type ts
# Check for token in CDN URLs
```

**Sanity Security Checklist:**
- [ ] Read-only token for frontend queries
- [ ] Write token only in authenticated server routes
- [ ] GROQ queries parameterized (not string concatenation)
- [ ] Webhook secret configured and validated
- [ ] Preview mode properly secured
- [ ] Draft content not exposed publicly

### Next.js Security Headers

```bash
# Check next.config.js/ts for security headers
rg "headers" -g "next.config.*" -A 20

# Required headers verification
rg "X-Frame-Options|X-Content-Type-Options|X-XSS-Protection" -g "next.config.*"
rg "Strict-Transport-Security|Content-Security-Policy" -g "next.config.*"
rg "Referrer-Policy|Permissions-Policy" -g "next.config.*"
```

**Required Security Headers:**
```ts
// next.config.ts
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]
```

**Missing Header = Critical Issue**

### Environment Variable Validation

```bash
# Find env usage without validation
rg "process\.env\." --type ts -A 1
rg "import\.meta\.env" --type ts -A 1

# Check for runtime validation
rg "zod|yup|joi" -g "env.*"
rg "env\.mjs|env\.ts" --type ts
```

**Required Pattern:**
```ts
// env.ts - validate at build time
import { z } from 'zod'

const envSchema = z.object({
  SHOPIFY_STOREFRONT_TOKEN: z.string().min(1),
  SANITY_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
})

export const env = envSchema.parse(process.env)
```

**Environment Security Checklist:**
- [ ] All env vars validated with Zod schema
- [ ] NEXT_PUBLIC_ prefix only for truly public values
- [ ] No secrets in NEXT_PUBLIC_ variables
- [ ] .env.local in .gitignore
- [ ] .env.example exists without real values
- [ ] Server-only secrets not importable in client components

---

## Vulnerability Patterns with Examples

### Pattern 1: Unvalidated Redirects

```ts
// VULNERABLE
export async function GET(request: Request) {
  const url = new URL(request.url)
  const redirect = url.searchParams.get('redirect')
  return Response.redirect(redirect!) // Open redirect!
}

// SECURE
const ALLOWED_HOSTS = ['darkroom.engineering', 'localhost:3000']
export async function GET(request: Request) {
  const url = new URL(request.url)
  const redirect = url.searchParams.get('redirect')

  try {
    const redirectUrl = new URL(redirect || '/')
    if (!ALLOWED_HOSTS.includes(redirectUrl.host)) {
      return Response.redirect('/')
    }
    return Response.redirect(redirectUrl.toString())
  } catch {
    return Response.redirect('/')
  }
}
```

### Pattern 2: Prototype Pollution

```ts
// VULNERABLE
function merge(target: any, source: any) {
  for (const key in source) {
    target[key] = source[key] // __proto__ can be polluted!
  }
}

// SECURE
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    target[key] = source[key]
  }
}
```

### Pattern 3: Mass Assignment

```ts
// VULNERABLE
export async function POST(request: Request) {
  const body = await request.json()
  await db.user.update({
    where: { id: session.userId },
    data: body // User can set isAdmin: true!
  })
}

// SECURE
export async function POST(request: Request) {
  const body = await request.json()
  const { name, email } = body // Explicit destructuring
  await db.user.update({
    where: { id: session.userId },
    data: { name, email } // Only allowed fields
  })
}
```

### Pattern 4: Path Traversal

```ts
// VULNERABLE
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')
  const content = await fs.readFile(`./uploads/${file}`) // ../../../etc/passwd
  return new Response(content)
}

// SECURE
import path from 'path'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const file = searchParams.get('file')

  const uploadsDir = path.resolve('./uploads')
  const filePath = path.resolve(uploadsDir, file || '')

  if (!filePath.startsWith(uploadsDir)) {
    return new Response('Forbidden', { status: 403 })
  }

  const content = await fs.readFile(filePath)
  return new Response(content)
}
```

### Pattern 5: Insecure Direct Object Reference (IDOR)

```ts
// VULNERABLE
export async function GET(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  const order = await db.order.findUnique({
    where: { id: params.orderId } // Any user can access any order!
  })
  return Response.json(order)
}

// SECURE
export async function GET(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  const session = await getSession()
  const order = await db.order.findFirst({
    where: {
      id: params.orderId,
      userId: session.userId // Ownership check
    }
  })

  if (!order) {
    return new Response('Not found', { status: 404 })
  }
  return Response.json(order)
}
```

---

## Security Checklist for PRs

### Pre-Merge Requirements

**Critical (Block if failing):**
- [ ] No secrets in code (run secret detection patterns)
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] No `eval()` or `new Function()`
- [ ] All API routes have authentication checks
- [ ] All user input is validated and sanitized
- [ ] No SQL/GROQ injection vulnerabilities
- [ ] Environment variables properly scoped (server vs client)

**High Priority:**
- [ ] Security headers configured in next.config
- [ ] CORS properly restricted (no wildcard *)
- [ ] Rate limiting on sensitive endpoints
- [ ] Error messages don't leak stack traces
- [ ] Logging doesn't include sensitive data

**Medium Priority:**
- [ ] Dependencies audited (`bun audit`)
- [ ] Cookies have secure flags (httpOnly, secure, sameSite)
- [ ] File uploads validated (type, size, content)
- [ ] Redirects validated against allowlist

**Shopify-Specific:**
- [ ] Admin tokens server-side only
- [ ] Webhook signatures verified
- [ ] Checkout flow tamper-proof

**Sanity-Specific:**
- [ ] Write tokens server-side only
- [ ] GROQ queries parameterized
- [ ] Preview mode access controlled
