---
name: tauri
description: Tauri desktop apps (Rust + Web)
---

# Tauri Profile (Desktop Apps)

> Darkroom conventions for Tauri v2 apps with a Rust backend and web frontend.

## Posture

Secure-by-default, minimal permissions, type-safe IPC. Priorities in order: security, cross-platform behavior (macOS, Windows, Linux), native speed for system operations, bundle size, type safety.

- The frontend is untrusted: validate every IPC input in Rust.
- Rust owns system access (files, shell, HTTP); the frontend owns UI.
- Grant the minimum through `src-tauri/capabilities/*.json`, scoped by path (for example `fs:allow-read` limited to `$APPDATA/**`), never a blanket `fs:default`.
- Set an explicit CSP in `tauri.conf.json` (`default-src 'self'`, widen per need).

## Structure

- `src/lib/commands.ts` holds typed `invoke` wrappers; components never call `invoke` with string names directly.
- `src-tauri/src/commands/` holds one module per IPC area; register each in `tauri::generate_handler!`.
- Commands return `Result<T, E>` where `E` is `String` or a `Serialize` error struct (`{ code, message }`).
- Rust state lives in `tauri::State` behind a `Mutex`; map lock errors with `map_err(|e| e.to_string())`, never `unwrap()`.
- Platform splits: `#[cfg(target_os = "...")]` in Rust, `@tauri-apps/plugin-os` `platform()` in the frontend.
- Commands: `bun tauri dev`, `bun tauri build`, `bun tauri icon`; add plugins with `bun add @tauri-apps/plugin-x` plus `cargo add tauri-plugin-x`.

## Gotchas

| Pitfall | Fix |
|---------|-----|
| Permission denied | Check capabilities and path scopes |
| `$APPDATA` path varies by OS | Use `@tauri-apps/api/path` helpers |
| Frontend can't access files | Move file ops to Rust commands |
| Async command hangs | Return `Result<T, String>`, not `T` |
| Events not received | Window label must match the capability's `windows` entry |
| `listen()` leaks | It returns a promise of `unlisten`; call it in the effect cleanup |
| Build fails on CI | Install platform deps (gtk3 on Linux) |
| Large bundle | Check for debug symbols; ship `--release` |
| IPC type mismatch | Rust structs derive `Serialize`/`Deserialize` |

## Pre-Implementation Checklist

- [ ] Capabilities defined with minimal, path-scoped permissions
- [ ] All file/system ops in Rust, not the frontend
- [ ] Typed command wrappers on the frontend
- [ ] Tested on all target platforms
- [ ] No debug symbols in the release bundle
