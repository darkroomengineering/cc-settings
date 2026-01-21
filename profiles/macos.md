# macOS Profile (AppKit/SwiftUI)

> Patterns for macOS desktop applications with SwiftUI and AppKit.

## Project Structure

```
App/
├── App.swift               # @main entry point
├── ContentView.swift       # Root view
├── Features/
│   ├── Sidebar/
│   │   └── SidebarView.swift
│   ├── Detail/
│   │   └── DetailView.swift
│   └── Settings/
│       └── SettingsView.swift
├── Components/
├── Services/
├── Models/
├── Commands/               # Menu commands
│   └── AppCommands.swift
├── Windows/                # Window definitions
└── Resources/
    ├── Assets.xcassets
    └── Localizable.xcstrings
```

---

## App Structure

### Main App
```swift
import SwiftUI

@main
struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .commands {
            AppCommands()
        }

        Settings {
            SettingsView()
        }

        Window("About", id: "about") {
            AboutView()
        }
        .windowResizability(.contentSize)
    }
}
```

### AppDelegate (when needed)
```swift
import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Setup code
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Cleanup
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false  // Keep running in menu bar
    }
}
```

---

## Window Management

### Multiple Windows
```swift
@main
struct MyApp: App {
    var body: some Scene {
        // Main window
        WindowGroup {
            ContentView()
        }

        // Secondary window type
        WindowGroup("Preview", for: Document.ID.self) { $documentId in
            if let documentId {
                PreviewView(documentId: documentId)
            }
        }

        // Single instance window
        Window("Inspector", id: "inspector") {
            InspectorView()
        }
        .keyboardShortcut("i", modifiers: [.command, .option])
    }
}

// Open window programmatically
@Environment(\.openWindow) var openWindow

Button("Open Preview") {
    openWindow(id: "preview", value: document.id)
}
```

### Window Styling
```swift
WindowGroup {
    ContentView()
}
.windowStyle(.hiddenTitleBar)
.windowToolbarStyle(.unified)

// Or with modifiers
ContentView()
    .frame(minWidth: 800, minHeight: 600)
    .toolbar {
        ToolbarItem(placement: .navigation) {
            Button(action: toggleSidebar) {
                Image(systemName: "sidebar.left")
            }
        }
    }
```

---

## Sidebar Navigation

### Three-Column Layout
```swift
struct ContentView: View {
    @State private var selectedCategory: Category?
    @State private var selectedItem: Item?

    var body: some View {
        NavigationSplitView {
            // Sidebar
            List(categories, selection: $selectedCategory) { category in
                NavigationLink(value: category) {
                    Label(category.name, systemImage: category.icon)
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } content: {
            // Content list
            if let category = selectedCategory {
                List(category.items, selection: $selectedItem) { item in
                    NavigationLink(value: item) {
                        ItemRow(item: item)
                    }
                }
            } else {
                ContentUnavailableView("Select a Category", systemImage: "folder")
            }
        } detail: {
            // Detail view
            if let item = selectedItem {
                ItemDetailView(item: item)
            } else {
                ContentUnavailableView("Select an Item", systemImage: "doc")
            }
        }
    }
}
```

### Two-Column Layout
```swift
NavigationSplitView {
    Sidebar()
} detail: {
    DetailView()
}
.navigationSplitViewStyle(.balanced)
```

---

## Menu Commands

### Custom Commands
```swift
struct AppCommands: Commands {
    @FocusedBinding(\.document) var document: Document?

    var body: some Commands {
        // Replace existing menu
        CommandGroup(replacing: .newItem) {
            Button("New Document") {
                // Create new document
            }
            .keyboardShortcut("n", modifiers: .command)
        }

        // Add to existing menu
        CommandGroup(after: .sidebar) {
            Button("Toggle Inspector") {
                // Toggle inspector
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
        }

        // New menu
        CommandMenu("Document") {
            Button("Export...") {
                document?.export()
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
            .disabled(document == nil)

            Divider()

            Menu("Share") {
                Button("Copy Link") { }
                Button("Email") { }
            }
        }
    }
}
```

### Focused Values
```swift
// Define focused value key
struct FocusedDocumentKey: FocusedValueKey {
    typealias Value = Binding<Document>
}

extension FocusedValues {
    var document: Binding<Document>? {
        get { self[FocusedDocumentKey.self] }
        set { self[FocusedDocumentKey.self] = newValue }
    }
}

// Provide value from view
struct DocumentView: View {
    @Binding var document: Document

    var body: some View {
        EditorView(document: $document)
            .focusedSceneValue(\.document, $document)
    }
}
```

---

## Toolbar

### Toolbar Items
```swift
struct ContentView: View {
    @State private var searchText = ""

    var body: some View {
        MainContent()
            .toolbar {
                ToolbarItemGroup(placement: .navigation) {
                    Button(action: goBack) {
                        Image(systemName: "chevron.left")
                    }
                }

                ToolbarItem(placement: .primaryAction) {
                    Button(action: addItem) {
                        Image(systemName: "plus")
                    }
                }

                ToolbarItem {
                    Menu {
                        Button("Option 1") { }
                        Button("Option 2") { }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .searchable(text: $searchText, placement: .toolbar)
    }
}
```

### Customizable Toolbar
```swift
.toolbar(id: "main") {
    ToolbarItem(id: "new", placement: .primaryAction) {
        Button(action: newDocument) {
            Label("New", systemImage: "doc.badge.plus")
        }
    }

    ToolbarItem(id: "share", placement: .secondaryAction) {
        ShareLink(item: url)
    }
}
.toolbarRole(.editor)
```

---

## Settings Window

### Settings View
```swift
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettingsView()
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            AppearanceSettingsView()
                .tabItem {
                    Label("Appearance", systemImage: "paintbrush")
                }

            AccountSettingsView()
                .tabItem {
                    Label("Account", systemImage: "person")
                }
        }
        .frame(width: 450, height: 300)
    }
}

struct GeneralSettingsView: View {
    @AppStorage("launchAtLogin") private var launchAtLogin = false
    @AppStorage("checkForUpdates") private var checkForUpdates = true

    var body: some View {
        Form {
            Toggle("Launch at Login", isOn: $launchAtLogin)
            Toggle("Check for Updates", isOn: $checkForUpdates)
        }
        .padding()
    }
}
```

---

## File Operations

### Open/Save Panels
```swift
struct DocumentView: View {
    @State private var showOpenPanel = false
    @State private var showSavePanel = false

    var body: some View {
        VStack {
            Button("Open...") {
                showOpenPanel = true
            }
            .fileImporter(
                isPresented: $showOpenPanel,
                allowedContentTypes: [.json, .plainText],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        loadDocument(from: url)
                    }
                case .failure(let error):
                    print("Error: \(error)")
                }
            }

            Button("Save As...") {
                showSavePanel = true
            }
            .fileExporter(
                isPresented: $showSavePanel,
                document: document,
                contentType: .json,
                defaultFilename: "document.json"
            ) { result in
                // Handle result
            }
        }
    }
}
```

### Drag and Drop
```swift
struct DropTargetView: View {
    @State private var isTargeted = false

    var body: some View {
        Rectangle()
            .fill(isTargeted ? Color.blue.opacity(0.3) : Color.gray.opacity(0.1))
            .overlay {
                Text("Drop files here")
            }
            .dropDestination(for: URL.self) { urls, location in
                handleDrop(urls)
                return true
            } isTargeted: { targeted in
                isTargeted = targeted
            }
    }
}

// Draggable item
Text(item.name)
    .draggable(item.url)
```

---

## Document-Based Apps

### Document Type
```swift
import SwiftUI
import UniformTypeIdentifiers

struct TextDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText] }

    var text: String

    init(text: String = "") {
        self.text = text
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let string = String(data: data, encoding: .utf8) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        text = string
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let data = text.data(using: .utf8)!
        return FileWrapper(regularFileWithContents: data)
    }
}
```

### Document App
```swift
@main
struct TextEditorApp: App {
    var body: some Scene {
        DocumentGroup(newDocument: TextDocument()) { file in
            TextEditorView(document: file.$document)
        }
    }
}

struct TextEditorView: View {
    @Binding var document: TextDocument

    var body: some View {
        TextEditor(text: $document.text)
            .font(.system(.body, design: .monospaced))
    }
}
```

---

## Menu Bar Apps

### Menu Bar Extra
```swift
@main
struct MenuBarApp: App {
    var body: some Scene {
        MenuBarExtra("Status", systemImage: "circle.fill") {
            MenuBarContent()
        }
        .menuBarExtraStyle(.window)  // or .menu for simple menu
    }
}

struct MenuBarContent: View {
    @Environment(\.openWindow) var openWindow

    var body: some View {
        VStack {
            Text("Status: Active")
                .font(.headline)

            Divider()

            Button("Open Settings") {
                openWindow(id: "settings")
            }

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .padding()
        .frame(width: 200)
    }
}
```

---

## AppKit Integration

### NSViewRepresentable
```swift
struct WebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        WKWebView()
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        let request = URLRequest(url: url)
        nsView.load(request)
    }
}
```

### NSViewControllerRepresentable
```swift
struct PreferencesViewController: NSViewControllerRepresentable {
    func makeNSViewController(context: Context) -> NSViewController {
        let storyboard = NSStoryboard(name: "Preferences", bundle: nil)
        return storyboard.instantiateInitialController() as! NSViewController
    }

    func updateNSViewController(_ nsViewController: NSViewController, context: Context) {}
}
```

---

## System Integration

### Services
```swift
class ServiceProvider: NSObject {
    @objc func processText(_ pboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let text = pboard.string(forType: .string) else { return }

        let processed = text.uppercased()

        pboard.clearContents()
        pboard.setString(processed, forType: .string)
    }
}

// Register in AppDelegate
NSApp.servicesProvider = ServiceProvider()
```

### Notifications
```swift
import UserNotifications

func sendNotification(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    let request = UNNotificationRequest(
        identifier: UUID().uuidString,
        content: content,
        trigger: nil  // Immediate
    )

    UNUserNotificationCenter.current().add(request)
}
```

---

## Keyboard Shortcuts

### Global Shortcuts
```swift
// In Commands
Button("Find") {
    // Action
}
.keyboardShortcut("f", modifiers: .command)

// Custom key
.keyboardShortcut(.return, modifiers: [.command, .shift])

// Escape key
.keyboardShortcut(.escape, modifiers: [])
```

### Focus Management
```swift
struct SearchView: View {
    @FocusState private var isSearchFocused: Bool
    @State private var searchText = ""

    var body: some View {
        TextField("Search", text: $searchText)
            .focused($isSearchFocused)
            .onAppear {
                isSearchFocused = true
            }
    }
}
```

---

## Security & Sandboxing

### Entitlements
```xml
<!-- App.entitlements -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

### Security-Scoped Bookmarks
```swift
// Save bookmark
func saveBookmark(for url: URL) throws {
    let bookmarkData = try url.bookmarkData(
        options: .withSecurityScope,
        includingResourceValuesForKeys: nil,
        relativeTo: nil
    )
    UserDefaults.standard.set(bookmarkData, forKey: "savedBookmark")
}

// Restore bookmark
func restoreBookmark() throws -> URL? {
    guard let bookmarkData = UserDefaults.standard.data(forKey: "savedBookmark") else {
        return nil
    }

    var isStale = false
    let url = try URL(
        resolvingBookmarkData: bookmarkData,
        options: .withSecurityScope,
        relativeTo: nil,
        bookmarkDataIsStale: &isStale
    )

    if url.startAccessingSecurityScopedResource() {
        return url
    }
    return nil
}
```

---

## Distribution

### Notarization
```bash
# Archive
xcodebuild archive -scheme MyApp -archivePath MyApp.xcarchive

# Export
xcodebuild -exportArchive -archivePath MyApp.xcarchive \
  -exportPath ./build -exportOptionsPlist ExportOptions.plist

# Notarize
xcrun notarytool submit MyApp.dmg --apple-id "dev@example.com" \
  --password "@keychain:AC_PASSWORD" --team-id "TEAM_ID" --wait

# Staple
xcrun stapler staple MyApp.app
```

### Sparkle Updates
```swift
import Sparkle

class UpdaterDelegate: NSObject, SPUUpdaterDelegate {
    let updaterController: SPUStandardUpdaterController

    override init() {
        updaterController = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        super.init()
    }

    func checkForUpdates() {
        updaterController.updater.checkForUpdates()
    }
}
```

---

## Performance Tips

1. **Use lazy loading** - `LazyVStack`, `LazyHStack` for large content
2. **Optimize images** - Use appropriate resolutions for Retina displays
3. **Profile with Instruments** - Memory, CPU, and energy usage
4. **Minimize AppKit bridging** - Keep SwiftUI where possible
5. **Background operations** - Use actors and async for heavy work
