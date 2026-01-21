# Tauri Development Context

> Context for cross-platform desktop applications with Tauri (Rust + Web).

---

## Behavioral Mode

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
src/                    # Frontend (React/Vite)
├── components/
├── lib/
│   └── commands.ts     # Type-safe IPC wrappers
└── App.tsx
src-tauri/              # Rust backend
├── src/
│   ├── main.rs         # Entry point
│   ├── lib.rs          # Command registration
│   └── commands/       # IPC command modules
├── capabilities/       # Permission definitions
├── Cargo.toml
└── tauri.conf.json
```

---

## IPC Pattern

### Rust Commands
```rust
// src-tauri/src/commands/files.rs
use tauri::command;

#[command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())
}

#[command]
pub fn validate_input(input: String) -> Result<bool, String> {
    // Always validate in Rust, not frontend
    if input.is_empty() {
        return Err("Input cannot be empty".into());
    }
    Ok(true)
}
```

### Registration
```rust
// src-tauri/src/lib.rs
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::files::read_file,
            commands::files::validate_input,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Type-Safe Frontend Wrappers
```typescript
// src/lib/commands.ts
import { invoke } from '@tauri-apps/api/core'

export async function readFile(path: string): Promise<string> {
  return invoke('read_file', { path })
}

export async function validateInput(input: string): Promise<boolean> {
  return invoke('validate_input', { input })
}
```

---

## Capabilities (Permissions)

### Define Capabilities
```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default permissions for main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    {
      "identifier": "fs:allow-read",
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

## Event System

### Emit from Rust
```rust
use tauri::{AppHandle, Emitter};

#[command]
pub fn start_task(app: AppHandle) {
    std::thread::spawn(move || {
        for i in 0..=100 {
            app.emit("progress", i).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}
```

### Listen in Frontend
```typescript
import { listen } from '@tauri-apps/api/event'

useEffect(() => {
  const unlisten = listen<number>('progress', (event) => {
    setProgress(event.payload)
  })
  return () => { unlisten.then(fn => fn()) }
}, [])
```

---

## State Management (Rust)

```rust
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<Database>,
}

// In lib.rs
tauri::Builder::default()
    .manage(AppState {
        db: Mutex::new(Database::connect()?),
    })
    .invoke_handler(...)

// In commands
#[command]
pub fn get_data(state: tauri::State<'_, AppState>) -> Result<Data, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_data()
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

## Development Commands

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
- [ ] IPC commands return `Result<T, String>`
- [ ] Frontend has type-safe command wrappers
- [ ] Platform-specific code handled gracefully
- [ ] Tested on all target platforms
- [ ] Bundle size reasonable (no debug symbols in release)
- [ ] Error states handled in both Rust and frontend
