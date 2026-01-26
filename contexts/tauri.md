# Tauri Context

Activates Tauri desktop app development mode. See full reference: `profiles/tauri.md`

## Quick Reference

- **IPC patterns** - invoke/listen with type-safe wrappers
- **Capability-based permissions** - minimal access, scoped paths
- **Rust command handlers** - validate in backend, not frontend
- **Window management** - multi-window, tray, cross-platform
- **Event system** - Rust emit, frontend listen
- **File system** - plugin-fs with BaseDirectory helpers

## Philosophy

Frontend is untrusted. Rust handles system access, frontend handles UI. Request only needed permissions.

For detailed patterns, code examples, and the full API reference, check `profiles/tauri.md`.
