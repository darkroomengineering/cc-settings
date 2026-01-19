# Tauri Profile (Desktop Apps)

> Patterns for Tauri desktop applications with Rust backend and web frontend.

## Project Structure

```
src/                    # Frontend (React/Vue/Svelte)
├── components/
├── lib/
└── App.tsx
src-tauri/              # Rust backend
├── src/
│   ├── main.rs         # Entry point
│   ├── lib.rs          # Library exports
│   └── commands/       # IPC commands
├── Cargo.toml
├── tauri.conf.json     # Tauri config
└── capabilities/       # Permission policies
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

// With state
#[command]
pub fn get_count(state: tauri::State<'_, AppState>) -> i32 {
    *state.count.lock().unwrap()
}
```

### Register Commands
```rust
// src-tauri/src/main.rs
mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::fetch_data,
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

// Type-safe wrapper
async function greet(name: string): Promise<string> {
  return invoke('greet', { name })
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
import { listen } from '@tauri-apps/api/event'

useEffect(() => {
  const unlisten = listen<number>('progress', (event) => {
    setProgress(event.payload)
  })

  return () => {
    unlisten.then(fn => fn())
  }
}, [])

// One-time listener
import { once } from '@tauri-apps/api/event'
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

## Security

### Capability-Based Permissions
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

## Development Tips

### Hot Reload
```bash
# Development with hot reload
bun tauri dev

# Build for production
bun tauri build
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

## Common Patterns

### State Management
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
```

### Error Handling
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
