# Tauri Profile (Desktop Apps)

> Patterns for Tauri desktop applications with Rust backend and web frontend.

---

## Philosophy

**Secure-by-default, minimal-permissions, type-safe IPC.**

- Frontend is untrusted - validate everything in Rust
- Request only needed permissions via capabilities
- Rust handles system access, frontend handles UI
- Build for all platforms, test on each

---

## Priorities (Ordered)

1. **Security** - Capability-based permissions, validate all IPC
2. **Cross-Platform** - Works on macOS, Windows, Linux
3. **Performance** - Native speed for system operations
4. **Bundle Size** - Smaller than Electron by design
5. **Type Safety** - TypeScript frontend, Rust backend

---

## Project Structure

```
src/                    # Frontend (React/Vue/Svelte)
├── components/
├── lib/
│   └── commands.ts     # Type-safe IPC wrappers
└── App.tsx
src-tauri/              # Rust backend
├── src/
│   ├── main.rs         # Entry point
│   ├── lib.rs          # Library exports
│   └── commands/       # IPC command modules
├── capabilities/       # Permission definitions
├── Cargo.toml
└── tauri.conf.json     # Tauri config
```

---

## IPC Commands

### Define Commands (Rust)
```rust
// src-tauri/src/commands/mod.rs
use tauri::command;

#[command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[command]
pub async fn fetch_data(id: i32) -> Result<Data, String> {
    // Async operation
    db::get_data(id)
        .await
        .map_err(|e| e.to_string())
}

// Always validate in Rust, not frontend
#[command]
pub fn validate_input(input: String) -> Result<bool, String> {
    if input.is_empty() {
        return Err("Input cannot be empty".into());
    }
    Ok(true)
}

// With state
#[command]
pub fn get_count(state: tauri::State<'_, AppState>) -> i32 {
    *state.count.lock().unwrap()
}
```

### Register Commands
```rust
// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::fetch_data,
            commands::validate_input,
            commands::get_count,
        ])
        .manage(AppState::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Invoke from Frontend
```tsx
import { invoke } from '@tauri-apps/api/core'

// Simple call
const greeting = await invoke<string>('greet', { name: 'World' })

// With error handling
try {
  const data = await invoke<Data>('fetch_data', { id: 123 })
  setData(data)
} catch (error) {
  console.error('Failed to fetch:', error)
}
```

### Type-Safe Frontend Wrappers
```typescript
// src/lib/commands.ts
import { invoke } from '@tauri-apps/api/core'

export async function greet(name: string): Promise<string> {
  return invoke('greet', { name })
}

export async function fetchData(id: number): Promise<Data> {
  return invoke('fetch_data', { id })
}

export async function validateInput(input: string): Promise<boolean> {
  return invoke('validate_input', { input })
}
```

---

## Event System

### Emit from Rust
```rust
use tauri::{AppHandle, Emitter};

#[command]
pub fn start_process(app: AppHandle) {
    std::thread::spawn(move || {
        for i in 0..100 {
            app.emit("progress", i).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        app.emit("complete", ()).unwrap();
    });
}
```

### Listen in Frontend
```tsx
import { listen, once } from '@tauri-apps/api/event'

useEffect(() => {
  const unlisten = listen<number>('progress', (event) => {
    setProgress(event.payload)
  })

  return () => {
    unlisten.then(fn => fn())
  }
}, [])

// One-time listener
await once('complete', () => {
  console.log('Process complete!')
})
```

### Emit from Frontend
```tsx
import { emit } from '@tauri-apps/api/event'

emit('user-action', { type: 'click', target: 'button' })
```

---

## Window Management

### Create Windows
```rust
use tauri::{Manager, WebviewWindowBuilder};

#[command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App("/settings".into()))
        .title("Settings")
        .inner_size(600.0, 400.0)
        .resizable(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

### Frontend Window API
```tsx
import { getCurrentWindow } from '@tauri-apps/api/window'

const appWindow = getCurrentWindow()

// Window controls
await appWindow.minimize()
await appWindow.maximize()
await appWindow.close()

// Window state
await appWindow.setTitle('New Title')
await appWindow.setFullscreen(true)
const isMaximized = await appWindow.isMaximized()

// Position & size
await appWindow.setPosition(new LogicalPosition(100, 100))
await appWindow.setSize(new LogicalSize(800, 600))
```

### Multi-Window Communication
```tsx
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

// Get window by label
const settingsWindow = await WebviewWindow.getByLabel('settings')
await settingsWindow?.emit('update-settings', newSettings)

// Create new window
const newWindow = new WebviewWindow('preview', {
  url: '/preview',
  width: 800,
  height: 600,
})

newWindow.once('tauri://created', () => {
  console.log('Window created')
})
```

---

## File System

### Configure Permissions
```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "fs:default",
    "fs:allow-read",
    "fs:allow-write",
    "fs:scope-app-data"
  ]
}
```

### File Operations
```tsx
import {
  readTextFile,
  writeTextFile,
  readDir,
  exists,
  mkdir,
  remove
} from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

// Read file
const content = await readTextFile('config.json', {
  baseDir: BaseDirectory.AppData
})

// Write file
await writeTextFile('config.json', JSON.stringify(config), {
  baseDir: BaseDirectory.AppData
})

// Check existence
const fileExists = await exists('config.json', {
  baseDir: BaseDirectory.AppData
})

// Create directory
const dataDir = await appDataDir()
const logsDir = await join(dataDir, 'logs')
await mkdir(logsDir, { recursive: true })

// List directory
const entries = await readDir(dataDir)
```

### File Dialogs
```tsx
import { open, save } from '@tauri-apps/plugin-dialog'

// Open file
const selected = await open({
  multiple: false,
  filters: [{
    name: 'Documents',
    extensions: ['pdf', 'doc', 'docx']
  }]
})

// Save file
const filePath = await save({
  filters: [{
    name: 'JSON',
    extensions: ['json']
  }]
})
```

---

## Capabilities (Permissions)

### Define Capabilities
```json
// src-tauri/capabilities/main.json
{
  "identifier": "main-capability",
  "description": "Main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "dialog:allow-open",
    "dialog:allow-save",
    {
      "identifier": "fs:allow-read",
      "allow": [{ "path": "$APPDATA/**" }]
    },
    {
      "identifier": "fs:allow-write",
      "allow": [{ "path": "$APPDATA/**" }]
    }
  ]
}
```

### Common Permission Patterns

| Need | Permission |
|------|------------|
| Read app data | `fs:allow-read` + scope to `$APPDATA` |
| Write app data | `fs:allow-write` + scope to `$APPDATA` |
| Open URLs | `shell:allow-open` |
| System dialogs | `dialog:allow-open`, `dialog:allow-save` |
| HTTP requests | `http:default` with allowed URLs |

### CSP Configuration
```json
// tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: https:; script-src 'self'"
    }
  }
}
```

---

## System Tray

### Configure Tray
```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running application");
}
```

---

## App Updates

### Configure Updater
```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "pubkey": "YOUR_PUBLIC_KEY",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

### Check for Updates
```tsx
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

async function checkForUpdates() {
  const update = await check()

  if (update) {
    console.log(`Update available: ${update.version}`)

    // Download and install
    await update.downloadAndInstall((event) => {
      if (event.event === 'Progress') {
        console.log(`Downloaded ${event.data.chunkLength} bytes`)
      }
    })

    // Restart app
    await relaunch()
  }
}
```

---

## State Management (Rust)

```rust
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Database>,
    pub config: Mutex<Config>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            db: Mutex::new(Database::new()),
            config: Mutex::new(Config::load()),
        }
    }
}

// In commands
#[command]
pub fn get_data(state: tauri::State<'_, AppState>) -> Result<Data, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_data()
}
```

---

## Error Handling

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError {
            code: "IO_ERROR".into(),
            message: err.to_string(),
        }
    }
}

#[command]
pub fn risky_operation() -> Result<Data, AppError> {
    // ...
}
```

---

## Platform-Specific Code

### Rust
```rust
#[cfg(target_os = "macos")]
fn macos_specific() {
    // macOS only
}

#[cfg(target_os = "windows")]
fn windows_specific() {
    // Windows only
}

#[cfg(target_os = "linux")]
fn linux_specific() {
    // Linux only
}
```

### Frontend
```typescript
import { platform } from '@tauri-apps/plugin-os'

const os = await platform()
if (os === 'macos') {
  // macOS styling
}
```

---

## Development

### Commands
```bash
# Development with hot reload
bun tauri dev

# Build for current platform
bun tauri build

# Build for specific target
bun tauri build --target universal-apple-darwin  # macOS universal
bun tauri build --target x86_64-pc-windows-msvc  # Windows

# Generate icons
bun tauri icon ./app-icon.png

# Add plugin
bun add @tauri-apps/plugin-fs
cargo add tauri-plugin-fs --crate-type lib
```

### Debug Rust
```rust
// Use dbg! macro
dbg!(&value);

// Or log crate
log::info!("Processing: {:?}", data);
```

### DevTools
```json
// tauri.conf.json (dev only)
{
  "app": {
    "withGlobalTauri": true
  }
}
```

Press `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux) to open DevTools.

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| Permission denied | Check capabilities, scope paths correctly |
| `$APPDATA` path varies by OS | Use `@tauri-apps/api/path` helpers |
| Frontend can't access files | Move file ops to Rust commands |
| Async command hangs | Return `Result<T, String>`, not `T` |
| Events not received | Check window label matches capability |
| Build fails on CI | Install platform deps (gtk3 on Linux) |
| Large bundle size | Check for debug symbols, use `--release` |
| IPC type mismatch | Ensure Rust structs derive `Serialize`/`Deserialize` |

---

## Documentation Sources

- **Tauri v2**: [v2.tauri.app](https://v2.tauri.app)
- **Tauri Plugins**: [v2.tauri.app/plugin](https://v2.tauri.app/plugin/)
- **Rust**: [doc.rust-lang.org](https://doc.rust-lang.org)
- **Capabilities**: [v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities/)

---

## Pre-Implementation Checklist

- [ ] Capabilities defined with minimal permissions
- [ ] All file/system ops in Rust, not frontend
- [ ] IPC commands return `Result<T, String>` or custom error type
- [ ] Frontend has type-safe command wrappers
- [ ] Platform-specific code handled gracefully
- [ ] Tested on all target platforms
- [ ] Bundle size reasonable (no debug symbols in release)
- [ ] Error states handled in both Rust and frontend
