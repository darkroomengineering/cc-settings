# iOS Development Context

> Context for iOS applications with Swift and SwiftUI.

---

## Behavioral Mode

**Type-safe, protocol-oriented, lifecycle-aware.**

- SwiftUI first, UIKit only when necessary
- MVVM architecture with clear separation
- Memory management is critical - watch for retain cycles
- Main thread for UI, background for heavy work

---

## Priorities (Ordered)

1. **Stability** - No crashes, handle all edge cases
2. **Performance** - Smooth 60fps, responsive UI
3. **Memory** - No leaks, efficient resource usage
4. **User Experience** - Follow HIG, feel native
5. **Testability** - Inject dependencies, mock boundaries

---

## Project Structure

```
App/
├── App.swift              # Entry point (@main)
├── Features/
│   └── [Feature]/
│       ├── Views/         # SwiftUI views
│       ├── ViewModels/    # ObservableObject classes
│       └── Models/        # Data models
├── Core/
│   ├── Services/          # API, persistence, etc.
│   ├── Extensions/        # Swift extensions
│   └── Utilities/         # Helpers
└── Resources/
    ├── Assets.xcassets
    └── Localizable.strings
```

---

## Favored Patterns

### MVVM with SwiftUI
```swift
// ViewModel
@MainActor
final class ProfileViewModel: ObservableObject {
    @Published private(set) var user: User?
    @Published private(set) var isLoading = false

    private let userService: UserServiceProtocol

    init(userService: UserServiceProtocol = UserService()) {
        self.userService = userService
    }

    func loadUser() async {
        isLoading = true
        defer { isLoading = false }
        user = try? await userService.fetchCurrentUser()
    }
}

// View
struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if let user = viewModel.user {
                UserContent(user: user)
            }
        }
        .task { await viewModel.loadUser() }
    }
}
```

### Dependency Injection
```swift
protocol UserServiceProtocol {
    func fetchCurrentUser() async throws -> User
}

// Production
final class UserService: UserServiceProtocol { ... }

// Testing
final class MockUserService: UserServiceProtocol { ... }
```

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| Retain cycles in closures | Use `[weak self]` or `[unowned self]` |
| UI updates on background thread | Dispatch to `@MainActor` or `DispatchQueue.main` |
| Force unwrapping (`!`) | Use `guard let`, `if let`, or nil coalescing |
| Blocking main thread | Use `Task { }` or async/await |
| Missing `@Published` | Properties won't trigger view updates |
| `@StateObject` vs `@ObservedObject` | `@StateObject` for ownership, `@ObservedObject` for injection |
| `NavigationView` deprecated | Use `NavigationStack` (iOS 16+) |
| Forgetting `.task` cleanup | Tasks auto-cancel on view disappear |

---

## Memory Management

```swift
// Weak reference for delegates
weak var delegate: SomeDelegate?

// Capture list for closures
someAsyncOperation { [weak self] result in
    guard let self else { return }
    self.handleResult(result)
}

// Unowned when lifecycle is guaranteed
class Parent {
    lazy var child = Child(parent: self)
}

class Child {
    unowned let parent: Parent  // Parent always outlives Child
}
```

---

## Threading

```swift
// Modern async/await
func fetchData() async throws -> Data {
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}

// MainActor for UI
@MainActor
func updateUI(with data: Data) {
    self.data = data
}

// Background work
Task.detached(priority: .background) {
    let result = await heavyComputation()
    await MainActor.run { self.result = result }
}
```

---

## Testing

```swift
// XCTest
final class ProfileViewModelTests: XCTestCase {
    var sut: ProfileViewModel!
    var mockService: MockUserService!

    override func setUp() {
        mockService = MockUserService()
        sut = ProfileViewModel(userService: mockService)
    }

    func testLoadUser_success() async {
        mockService.userToReturn = User.mock

        await sut.loadUser()

        XCTAssertEqual(sut.user, User.mock)
        XCTAssertFalse(sut.isLoading)
    }
}
```

---

## Documentation Sources

- **Swift**: [swift.org/documentation](https://swift.org/documentation)
- **SwiftUI**: [developer.apple.com/swiftui](https://developer.apple.com/documentation/swiftui)
- **HIG**: [developer.apple.com/design/human-interface-guidelines](https://developer.apple.com/design/human-interface-guidelines)
- **App Store Review**: [developer.apple.com/app-store/review/guidelines](https://developer.apple.com/app-store/review/guidelines)

---

## Pre-Implementation Checklist

- [ ] Architecture follows MVVM pattern
- [ ] Dependencies are injectable/mockable
- [ ] No force unwraps without justification
- [ ] Async work off main thread
- [ ] Memory: no retain cycles in closures
- [ ] Accessibility labels on interactive elements
- [ ] Supports Dynamic Type
- [ ] Handles all error states gracefully
