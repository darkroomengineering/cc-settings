---
name: file-backup
trigger: pre-edit
description: Creates backup copies of files before modification
enabled: false
backupDir: .claude-backups
maxBackups: 5
---

**Purpose:** Provide safety net for reverting changes.

**Behavior:**

```
ON pre_edit:
  IF file_exists:
    CREATE backup in_backup_dir
    ROTATE old_backups (keep max 5)
    LOG backup_created
```

**Backup Structure:**

```
.claude-backups/
  src/
    components/
      Button.tsx.1704067200.bak
      Button.tsx.1704067100.bak
      Button.tsx.1704067000.bak
```

**Commands:**

```bash
# Create backup
cp src/file.ts .claude-backups/src/file.ts.$(date +%s).bak

# Restore from backup
cp .claude-backups/src/file.ts.TIMESTAMP.bak src/file.ts

# List backups for file
ls -la .claude-backups/src/file.ts.*.bak
```

**Output:**

```markdown
📁 Backup created

File: `src/components/Button.tsx`
Backup: `.claude-backups/src/components/Button.tsx.1704067200.bak`

## Available Backups (5 max)
1. 2024-01-01 10:00:00 - Button.tsx.1704067200.bak
2. 2024-01-01 09:55:00 - Button.tsx.1704067100.bak
3. 2024-01-01 09:50:00 - Button.tsx.1704067000.bak

## Restore Command
`restore Button.tsx 1` - Restore most recent backup
```

**Note:** This hook is disabled by default. Enable in settings.json if you want file backups. Git history is usually sufficient for most projects.
