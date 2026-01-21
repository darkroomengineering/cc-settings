# Security

> Protect secrets, validate inputs, prevent common vulnerabilities

---

## DO

### Secret Management
```bash
# Environment variables for secrets
DATABASE_URL=postgres://...
API_KEY=sk-...
# .env.local for dev (gitignored), platform secrets for prod
```
```tsx
const apiKey = process.env.API_KEY  // Server-side only
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
```

### Input Validation
```tsx
import { z } from 'zod'

const UserInput = z.object({
  email: z.string().email(),
  age: z.number().int().positive().max(150),
})

export async function createUser(input: unknown) {
  const data = UserInput.parse(input)  // Throws on invalid
}
```

### SQL Injection Prevention
```tsx
// Parameterized queries
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId])
// Or ORM
const user = await prisma.user.findUnique({ where: { id: userId } })
```

---

## DON'T

```bash
# Never commit these
.env  .env.local  .env.production
credentials.json  *.pem  *.key
```
```tsx
// WRONG: Expose secrets to client
export const config = { apiKey: process.env.API_KEY }
// Only NEXT_PUBLIC_* vars are safe for client

// WRONG: SQL injection
const query = `SELECT * FROM users WHERE name = '${name}'`

// WRONG: XSS
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// WRONG: Open redirect
redirect(req.query.returnUrl)
```

---

## OWASP Top 10

| Vulnerability | Prevention |
|--------------|------------|
| Injection | Parameterized queries, ORM |
| Broken Auth | NextAuth, Clerk |
| XSS | Escape output, CSP headers |
| CSRF | SameSite cookies |

## Tools
- **git-secrets** - Prevents committing secrets
- **Snyk/Dependabot** - Vulnerability scanning
