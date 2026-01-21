# TypeScript

> Strict types, no shortcuts, maintainable code

---

## DO

### Strict Mode
```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }
```

### Interface for Objects, Type for Unions
```tsx
interface User { id: string; name: string }
type Status = 'idle' | 'loading' | 'success' | 'error'
```

### Narrow Unknown Types
```tsx
function processData(data: unknown) {
  if (typeof data === 'string') return data.toUpperCase()
  if (isUser(data)) return data.name
  throw new Error('Invalid data')
}

function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'name' in data
}
```

### Discriminated Unions
```tsx
type State =
  | { status: 'loading' }
  | { status: 'success'; data: User[] }
  | { status: 'error'; error: Error }

function render(state: State) {
  switch (state.status) {
    case 'loading': return <Spinner />
    case 'success': return <UserList users={state.data} />
    case 'error': return <Error message={state.error.message} />
  }
}
```

### Export Types with Implementations
```tsx
export interface User { id: string; name: string }
export function createUser(name: string): User {
  return { id: crypto.randomUUID(), name }
}
```

---

## DON'T

```tsx
// WRONG: any
function process(data: any) { ... }
// CORRECT
function process(data: unknown) { ... }

// WRONG: Careless assertions
const user = data as User
// CORRECT
const user = UserSchema.parse(data)

// WRONG: Ignoring errors
// @ts-ignore

// WRONG: Over-engineered generics
function get<T, K extends keyof T, V extends T[K]>(obj: T, key: K): V
// CORRECT
function get<T>(obj: T, key: keyof T) { return obj[key] }
```

---

## Tools
- **Biome** - Linting and formatting
- **tsc --noEmit** - Type checking
