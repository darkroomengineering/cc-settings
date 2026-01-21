# iOS Profile (Swift/SwiftUI)

> Patterns for iOS applications with Swift, SwiftUI, and UIKit.

## Project Structure

```
App/
├── App.swift               # @main entry point
├── ContentView.swift       # Root view
├── Features/
│   ├── Home/
│   │   ├── HomeView.swift
│   │   └── HomeViewModel.swift
│   └── Profile/
│       ├── ProfileView.swift
│       └── ProfileViewModel.swift
├── Components/
│   ├── Buttons/
│   └── Cards/
├── Services/
│   ├── APIClient.swift
│   └── AuthService.swift
├── Models/
│   └── User.swift
├── Extensions/
└── Resources/
    ├── Assets.xcassets
    └── Localizable.xcstrings
```

---

## SwiftUI Basics

### View Structure
```swift
struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Count: \(count)")
                .font(.largeTitle)
                .fontWeight(.bold)

            Button("Increment") {
                count += 1
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
```

### Property Wrappers
```swift
// Local state
@State private var isExpanded = false

// Two-way binding from parent
@Binding var selectedTab: Int

// Environment values
@Environment(\.colorScheme) var colorScheme
@Environment(\.dismiss) var dismiss

// Observable object
@StateObject private var viewModel = ViewModel()  // Creates
@ObservedObject var viewModel: ViewModel          // Receives

// Environment object
@EnvironmentObject var appState: AppState

// App Storage (UserDefaults)
@AppStorage("username") var username = ""
```

---

## Navigation

### NavigationStack (iOS 16+)
```swift
struct RootView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List(items) { item in
                NavigationLink(value: item) {
                    ItemRow(item: item)
                }
            }
            .navigationTitle("Items")
            .navigationDestination(for: Item.self) { item in
                ItemDetailView(item: item)
            }
            .navigationDestination(for: User.self) { user in
                UserProfileView(user: user)
            }
        }
    }
}

// Programmatic navigation
path.append(item)           // Push
path.removeLast()           // Pop
path = NavigationPath()     // Pop to root
```

### Tab Navigation
```swift
struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house")
                }
                .tag(0)

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person")
                }
                .tag(1)
        }
    }
}
```

### Sheets & Modals
```swift
struct ParentView: View {
    @State private var showSheet = false
    @State private var showFullScreen = false

    var body: some View {
        Button("Show Sheet") {
            showSheet = true
        }
        .sheet(isPresented: $showSheet) {
            SheetContent()
        }
        .fullScreenCover(isPresented: $showFullScreen) {
            FullScreenContent()
        }
    }
}

// Dismissing from child
struct SheetContent: View {
    @Environment(\.dismiss) var dismiss

    var body: some View {
        Button("Close") {
            dismiss()
        }
    }
}
```

---

## MVVM Architecture

### ViewModel
```swift
import Observation

@Observable
final class ProfileViewModel {
    var user: User?
    var isLoading = false
    var errorMessage: String?

    private let apiClient: APIClient

    init(apiClient: APIClient = .shared) {
        self.apiClient = apiClient
    }

    func loadProfile() async {
        isLoading = true
        defer { isLoading = false }

        do {
            user = try await apiClient.fetchUser()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// Pre-iOS 17 (use @Published)
final class ProfileViewModel: ObservableObject {
    @Published var user: User?
    @Published var isLoading = false
}
```

### View with ViewModel
```swift
struct ProfileView: View {
    @State private var viewModel = ProfileViewModel()

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
            } else if let user = viewModel.user {
                UserContent(user: user)
            } else if let error = viewModel.errorMessage {
                ErrorView(message: error)
            }
        }
        .task {
            await viewModel.loadProfile()
        }
    }
}
```

---

## Async/Await

### Task in SwiftUI
```swift
struct AsyncView: View {
    @State private var data: [Item] = []

    var body: some View {
        List(data) { item in
            Text(item.name)
        }
        .task {
            // Automatically cancelled when view disappears
            data = await fetchItems()
        }
        .refreshable {
            // Pull-to-refresh
            data = await fetchItems()
        }
    }
}
```

### Async Functions
```swift
func fetchUser() async throws -> User {
    let url = URL(string: "https://api.example.com/user")!
    let (data, response) = try await URLSession.shared.data(from: url)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw APIError.invalidResponse
    }

    return try JSONDecoder().decode(User.self, from: data)
}

// Parallel execution
async let user = fetchUser()
async let posts = fetchPosts()
let (userData, postsData) = try await (user, posts)
```

### Actors
```swift
actor ImageCache {
    private var cache: [URL: UIImage] = [:]

    func image(for url: URL) -> UIImage? {
        cache[url]
    }

    func store(_ image: UIImage, for url: URL) {
        cache[url] = image
    }
}

// Usage
let cache = ImageCache()
await cache.store(image, for: url)
if let cached = await cache.image(for: url) { }
```

---

## Lists & Data

### Basic List
```swift
struct ItemListView: View {
    @State private var items: [Item] = []
    @State private var selection = Set<Item.ID>()

    var body: some View {
        List(items, selection: $selection) { item in
            ItemRow(item: item)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        deleteItem(item)
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $searchText)
    }
}
```

### Sections
```swift
List {
    Section("Recent") {
        ForEach(recentItems) { item in
            ItemRow(item: item)
        }
    }

    Section("All Items") {
        ForEach(allItems) { item in
            ItemRow(item: item)
        }
    }
}
```

---

## Forms & Input

### Form Layout
```swift
struct SettingsView: View {
    @State private var username = ""
    @State private var notificationsEnabled = true
    @State private var selectedTheme = Theme.system

    var body: some View {
        Form {
            Section("Account") {
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .autocorrectionDisabled()
            }

            Section("Preferences") {
                Toggle("Notifications", isOn: $notificationsEnabled)

                Picker("Theme", selection: $selectedTheme) {
                    ForEach(Theme.allCases) { theme in
                        Text(theme.rawValue).tag(theme)
                    }
                }
            }

            Section {
                Button("Save", action: save)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}
```

### Validation
```swift
struct LoginView: View {
    @State private var email = ""
    @State private var password = ""

    private var isValid: Bool {
        email.contains("@") && password.count >= 8
    }

    var body: some View {
        Form {
            TextField("Email", text: $email)
                .keyboardType(.emailAddress)
                .textContentType(.emailAddress)

            SecureField("Password", text: $password)
                .textContentType(.password)

            Button("Login") {
                login()
            }
            .disabled(!isValid)
        }
    }
}
```

---

## Networking

### APIClient
```swift
actor APIClient {
    static let shared = APIClient()

    private let baseURL = URL(string: "https://api.example.com")!
    private let decoder = JSONDecoder()
    private var token: String?

    func setToken(_ token: String) {
        self.token = token
    }

    func fetch<T: Decodable>(_ endpoint: String) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(endpoint))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard 200...299 ~= httpResponse.statusCode else {
            throw APIError.httpError(httpResponse.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }
}

enum APIError: Error {
    case invalidResponse
    case httpError(Int)
    case decodingError
}
```

---

## Local Storage

### UserDefaults
```swift
// Via @AppStorage
@AppStorage("hasCompletedOnboarding") var hasCompletedOnboarding = false

// Direct access
UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
let value = UserDefaults.standard.bool(forKey: "hasCompletedOnboarding")
```

### Keychain (via KeychainAccess)
```swift
import KeychainAccess

let keychain = Keychain(service: "com.app.myapp")

// Store
try keychain.set(token, key: "authToken")

// Retrieve
let token = try keychain.get("authToken")

// Delete
try keychain.remove("authToken")
```

### SwiftData (iOS 17+)
```swift
import SwiftData

@Model
final class Item {
    var name: String
    var timestamp: Date
    var category: Category?

    init(name: String, timestamp: Date = .now) {
        self.name = name
        self.timestamp = timestamp
    }
}

// In App
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: Item.self)
    }
}

// In View
struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var items: [Item]

    var body: some View {
        List(items) { item in
            Text(item.name)
        }
    }

    func addItem() {
        let item = Item(name: "New Item")
        modelContext.insert(item)
    }
}
```

---

## Animations

### Basic Animations
```swift
struct AnimatedView: View {
    @State private var isExpanded = false

    var body: some View {
        VStack {
            Rectangle()
                .fill(.blue)
                .frame(width: isExpanded ? 200 : 100, height: 100)
                .animation(.spring(duration: 0.3), value: isExpanded)

            Button("Toggle") {
                isExpanded.toggle()
            }
        }
    }
}

// With explicit animation
withAnimation(.easeInOut(duration: 0.3)) {
    isExpanded.toggle()
}
```

### Transitions
```swift
struct TransitionView: View {
    @State private var showDetail = false

    var body: some View {
        VStack {
            if showDetail {
                DetailView()
                    .transition(.asymmetric(
                        insertion: .slide.combined(with: .opacity),
                        removal: .scale.combined(with: .opacity)
                    ))
            }
        }
        .animation(.spring, value: showDetail)
    }
}
```

---

## UIKit Interop

### UIViewRepresentable
```swift
struct ActivityIndicator: UIViewRepresentable {
    var isAnimating: Bool

    func makeUIView(context: Context) -> UIActivityIndicatorView {
        let view = UIActivityIndicatorView(style: .large)
        return view
    }

    func updateUIView(_ uiView: UIActivityIndicatorView, context: Context) {
        isAnimating ? uiView.startAnimating() : uiView.stopAnimating()
    }
}
```

### UIViewControllerRepresentable
```swift
struct ImagePicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: ImagePicker

        init(_ parent: ImagePicker) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
    }
}
```

---

## Testing

### Unit Tests
```swift
import XCTest
@testable import MyApp

final class ProfileViewModelTests: XCTestCase {
    var sut: ProfileViewModel!
    var mockAPIClient: MockAPIClient!

    override func setUp() {
        mockAPIClient = MockAPIClient()
        sut = ProfileViewModel(apiClient: mockAPIClient)
    }

    func testLoadProfile_Success() async {
        mockAPIClient.userToReturn = User(id: "1", name: "Test")

        await sut.loadProfile()

        XCTAssertNotNil(sut.user)
        XCTAssertEqual(sut.user?.name, "Test")
        XCTAssertNil(sut.errorMessage)
    }
}
```

### UI Tests
```swift
import XCTest

final class LoginUITests: XCTestCase {
    var app: XCUIApplication!

    override func setUp() {
        app = XCUIApplication()
        app.launch()
    }

    func testLogin_WithValidCredentials_NavigatesToHome() {
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("test@example.com")

        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("password123")

        app.buttons["Login"].tap()

        XCTAssertTrue(app.staticTexts["Welcome"].waitForExistence(timeout: 5))
    }
}
```

---

## Performance Tips

1. **Avoid unnecessary redraws** - Use `@State` only for view-owned state
2. **Lazy loading** - Use `LazyVStack`/`LazyHStack` for large lists
3. **Image optimization** - Use proper image sizes and caching
4. **Background tasks** - Use `.task` modifier for async work
5. **Measure with Instruments** - Profile CPU, memory, and rendering
