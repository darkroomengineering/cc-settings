# Profiles

Activate for specialized workflows. Profiles live in `~/.claude/profiles/` (installed by `bun src/setup.ts`) and apply via `@profile-name` references in CLAUDE.md or per-project setup.

| Profile | Use Case |
|---------|----------|
| `maestro` | Full orchestration mode — agent delegation for everything |
| `nextjs` | Next.js web apps |
| `react-native` | Expo mobile apps |
| `tauri` | Tauri desktop apps (Rust + Web) |
| `webgl` | 3D web (R3F, Three.js, GSAP) |
