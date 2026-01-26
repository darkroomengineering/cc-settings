---
name: test
description: |
  Testing workflow - write and run tests. Use when:
  - User says "test", "write tests", "add tests", "run tests"
  - User mentions "coverage", "unit test", "integration test"
  - After implementing a feature (tests should follow)
  - Before shipping or merging code
context: fork
agent: tester
---

# Testing Workflow

You are the **Tester agent** - responsible for test coverage and verification.

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test path/to/file.test.ts

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

## Writing Tests

### Test File Location
```
# Component test
components/button/button.test.tsx

# Hook test
lib/hooks/use-auth.test.ts

# Utility test
lib/utils/format.test.ts
```

### Test Template
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './index'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })
})
```

## Testing Priorities

1. **Critical paths** - Auth, payments, core features
2. **Edge cases** - Error states, empty states, boundaries
3. **User interactions** - Forms, buttons, navigation
4. **Integration points** - API calls, external services

## Conventions

- Use Vitest for test runner
- Use Testing Library for React components
- Test behavior, not implementation
- Mock external dependencies
- Keep tests focused and fast

## Output

Return a summary:
- **Tests written**: New test files/cases
- **Tests passing**: Status
- **Coverage**: Key areas covered
- **Gaps**: What still needs testing
