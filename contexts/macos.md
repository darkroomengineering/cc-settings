# macOS Development Context

> Context for macOS native applications with SwiftUI and AppKit.

---

## Behavioral Mode

**Desktop-native, keyboard-first, system-integrated.**

- SwiftUI for new UI, AppKit for advanced features
- Respect macOS conventions (menu bar, keyboard shortcuts, window management)
- Sandboxing by default, request entitlements explicitly
- Code signing is required for distribution

---

## Priorities (Ordered)

1. **Reliability** - Desktop apps must be rock-solid
2. **System Integration** - Feel like a native Mac app
3. **Keyboard Navigation** - Power users expect shortcuts
4. **Performance** - Fast launch, responsive UI
5. **Security** - Sandbox, sign, notarize

---

## Project Structure

```
App/
├── App.swift              # @main entry point
├── AppDelegate.swift      # For AppKit lifecycle (if needed)
├── Features/
│   └── [Feature]/
│       ├── Views/
│       ├── ViewModels/
│       └── Models/
├── Menu/
│   └── MainMenu.swift     # Menu bar configuration
├── Services/
│   ├── Preferences/       # User defaults, settings
│   └── System/            # System integrations
└── Resources/
    └── Entitlements.plist
```

---

## App Lifecycle

### Pure SwiftUI
```swift
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("Tools") {
                Button("Run Analysis") { }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
            }
        }

        Settings {
            SettingsView()
        }

        MenuBarExtra("Status", systemImage: "star") {
            MenuBarView()
        }
    }
}
```

### With AppDelegate
```swift
@main
struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Setup that requires AppKit
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true  // or false for menu bar apps
    }
}
```

---

## Window Management

```swift
// Multiple window types
var body: some Scene {
    WindowGroup {
        MainView()
    }

    WindowGroup("Inspector", id: "inspector", for: UUID.self) { $itemId in
        InspectorView(itemId: itemId)
    }
    .defaultSize(width: 300, height: 600)
    .defaultPosition(.trailing)

    Window("About", id: "about") {
        AboutView()
    }
    .windowResizability(.contentSize)
}

// Open window programmatically
@Environment(\.openWindow) private var openWindow

Button("Show Inspector") {
    openWindow(id: "inspector", value: item.id)
}
```

---

## Menu Bar Apps

```swift
@main
struct MenuBarApp: App {
    var body: some Scene {
        MenuBarExtra {
            VStack {
                Button("Action") { performAction() }
                Divider()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
            .frame(width: 200)
        } label: {
            Image(systemName: "star.fill")
        }
        .menuBarExtraStyle(.window)  // or .menu for simple
    }
}
```

---

## Sandboxing & Entitlements

```xml
<!-- App.entitlements -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>

    <!-- Network access -->
    <key>com.apple.security.network.client</key>
    <true/>

    <!-- File access -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>

    <!-- Specific folder access -->
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
</dict>
</plist>
```

### Common Entitlements

| Entitlement | Purpose |
|-------------|---------|
| `network.client` | Outgoing network connections |
| `network.server` | Incoming network connections |
| `files.user-selected.read-write` | Open/save panels |
| `files.bookmarks.app-scope` | Persist file access |
| `temporary-exception.files.absolute-path.read-only` | Read specific paths |

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| No menu bar in SwiftUI | Use `.commands { }` modifier |
| Window won't close app | Implement `applicationShouldTerminateAfterLastWindowClosed` |
| File access denied | Check sandbox entitlements |
| App rejected for sandbox | Remove hardened runtime exceptions |
| Missing keyboard shortcuts | Add `.keyboardShortcut()` to buttons |
| Preferences not in menu | Add `Settings { }` scene |
| Can't access system folders | Use security-scoped bookmarks |
| Notarization fails | Enable hardened runtime, sign with Developer ID |

---

## Code Signing & Notarization

```bash
# Sign for development
codesign --sign "Developer ID Application: Name (TEAM_ID)" MyApp.app

# Notarize for distribution
xcrun notarytool submit MyApp.zip \
  --apple-id "email@example.com" \
  --team-id "TEAM_ID" \
  --password "@keychain:AC_PASSWORD" \
  --wait

# Staple the ticket
xcrun stapler staple MyApp.app
```

---

## macOS-Specific APIs

```swift
// System Preferences URL
NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference")!)

// Login item (LaunchAtLogin)
import ServiceManagement
SMAppService.mainApp.register()

// Global keyboard shortcuts
import Carbon
// Use HotKey library or Carbon APIs

// File system events
import Combine
let watcher = FileSystemWatcher(paths: ["/path/to/watch"])

// Spotlight metadata
import CoreSpotlight
let item = CSSearchableItem(uniqueIdentifier: id, domainIdentifier: nil, attributeSet: attributes)
CSSearchableIndex.default().indexSearchableItems([item])
```

---

## Documentation Sources

- **macOS HIG**: [developer.apple.com/design/human-interface-guidelines/macos](https://developer.apple.com/design/human-interface-guidelines/macos)
- **AppKit**: [developer.apple.com/documentation/appkit](https://developer.apple.com/documentation/appkit)
- **App Sandbox**: [developer.apple.com/documentation/security/app_sandbox](https://developer.apple.com/documentation/security/app_sandbox)
- **Notarization**: [developer.apple.com/documentation/security/notarizing_macos_software_before_distribution](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)

---

## Pre-Implementation Checklist

- [ ] App lifecycle chosen (pure SwiftUI vs AppDelegate)
- [ ] Window management strategy defined
- [ ] Menu bar configured with keyboard shortcuts
- [ ] Sandbox entitlements minimal and justified
- [ ] Settings/Preferences scene included
- [ ] Code signing configured for distribution
- [ ] Handles file access securely (bookmarks if persistent)
- [ ] Respects system appearance (light/dark mode)
