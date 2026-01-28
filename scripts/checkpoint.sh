#!/usr/bin/env bash
set -euo pipefail

# Checkpoint system for long-running Claude Code tasks
# Usage: checkpoint.sh <save|list|show|restore|clean> [args]

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Determine project name from git or directory
get_project_name() {
  basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
}

PROJECT=$(get_project_name)
CHECKPOINT_DIR="$HOME/.claude/checkpoints/$PROJECT"

ensure_dir() {
  mkdir -p "$CHECKPOINT_DIR"
}

# Generate checkpoint ID
checkpoint_id() {
  echo "chk-$(date +%Y%m%d-%H%M%S)"
}

cmd_save() {
  ensure_dir
  local description="${1:-Checkpoint}"
  local id
  id=$(checkpoint_id)
  local file="$CHECKPOINT_DIR/$id.json"

  # Gather git state
  local branch sha dirty modified_files
  branch=$(git branch --show-current 2>/dev/null || echo "unknown")
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  dirty=$(git diff --quiet 2>/dev/null && echo "false" || echo "true")
  modified_files=$(git diff --name-only HEAD 2>/dev/null | jq -R -s 'split("\n") | map(select(length > 0))' 2>/dev/null || echo "[]")

  # Build checkpoint JSON
  cat > "$file" <<EOF
{
  "id": "$id",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "project": "$PROJECT",
  "description": "$description",
  "git": {
    "branch": "$branch",
    "sha": "$sha",
    "dirty": $dirty,
    "modifiedFiles": $modified_files
  }
}
EOF

  # Update latest symlink
  ln -sf "$file" "$CHECKPOINT_DIR/latest"

  echo -e "${GREEN}Checkpoint saved:${NC} $id"
  echo -e "${CYAN}Description:${NC} $description"
  echo -e "${BLUE}Location:${NC} $file"
}

cmd_list() {
  ensure_dir
  local files
  files=$(ls -1 "$CHECKPOINT_DIR"/*.json 2>/dev/null)

  if [ -z "$files" ]; then
    echo -e "${YELLOW}No checkpoints found for project: $PROJECT${NC}"
    return 0
  fi

  echo -e "${BLUE}Checkpoints for ${CYAN}$PROJECT${NC}:"
  echo ""

  for f in $files; do
    local id desc ts
    id=$(jq -r '.id' "$f")
    desc=$(jq -r '.description' "$f")
    ts=$(jq -r '.timestamp' "$f")
    local latest_marker=""
    if [ "$(readlink "$CHECKPOINT_DIR/latest" 2>/dev/null)" = "$f" ]; then
      latest_marker=" ${GREEN}(latest)${NC}"
    fi
    echo -e "  ${CYAN}$id${NC}  $ts  $desc$latest_marker"
  done
  echo ""
}

cmd_show() {
  ensure_dir
  local target="${1:-}"
  local file

  if [ -z "$target" ]; then
    file=$(readlink "$CHECKPOINT_DIR/latest" 2>/dev/null || true)
    if [ -z "$file" ] || [ ! -f "$file" ]; then
      echo -e "${RED}No latest checkpoint found.${NC}"
      return 1
    fi
  else
    file="$CHECKPOINT_DIR/$target.json"
    if [ ! -f "$file" ]; then
      echo -e "${RED}Checkpoint not found: $target${NC}"
      return 1
    fi
  fi

  echo -e "${BLUE}Checkpoint Details:${NC}"
  jq '.' "$file"
}

cmd_restore() {
  ensure_dir
  local target="${1:-}"
  local file

  if [ -z "$target" ]; then
    file=$(readlink "$CHECKPOINT_DIR/latest" 2>/dev/null || true)
    if [ -z "$file" ] || [ ! -f "$file" ]; then
      echo -e "${RED}No latest checkpoint found.${NC}"
      return 1
    fi
  else
    file="$CHECKPOINT_DIR/$target.json"
    if [ ! -f "$file" ]; then
      echo -e "${RED}Checkpoint not found: $target${NC}"
      return 1
    fi
  fi

  local id desc branch sha
  id=$(jq -r '.id' "$file")
  desc=$(jq -r '.description' "$file")
  branch=$(jq -r '.git.branch' "$file")
  sha=$(jq -r '.git.sha' "$file")

  echo -e "${GREEN}Restoring checkpoint:${NC} $id"
  echo -e "${CYAN}Description:${NC} $desc"
  echo -e "${BLUE}Branch:${NC} $branch @ $sha"
  echo ""

  # Verify git state
  local current_branch
  current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
  local current_sha
  current_sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  if [ "$current_branch" != "$branch" ]; then
    echo -e "${YELLOW}WARNING: Current branch ($current_branch) differs from checkpoint ($branch)${NC}"
  fi
  if [ "$current_sha" != "$sha" ]; then
    echo -e "${YELLOW}WARNING: Current SHA ($current_sha) differs from checkpoint ($sha)${NC}"
  fi

  echo ""
  echo -e "${GREEN}Checkpoint state loaded. Review above and continue work.${NC}"
  cat "$file"
}

cmd_clean() {
  ensure_dir
  local keep="${1:-10}"
  local files
  files=$(ls -1t "$CHECKPOINT_DIR"/*.json 2>/dev/null)
  local count
  count=$(echo "$files" | wc -l | tr -d ' ')

  if [ "$count" -le "$keep" ]; then
    echo -e "${GREEN}Nothing to clean. $count checkpoints (keep: $keep).${NC}"
    return 0
  fi

  local to_delete
  to_delete=$(echo "$files" | tail -n +"$((keep + 1))")
  local del_count
  del_count=$(echo "$to_delete" | wc -l | tr -d ' ')

  echo -e "${YELLOW}Removing $del_count old checkpoints (keeping $keep)...${NC}"
  echo "$to_delete" | xargs rm -f
  echo -e "${GREEN}Done.${NC}"
}

# Main
case "${1:-help}" in
  save)    cmd_save "${2:-}" ;;
  list)    cmd_list ;;
  show)    cmd_show "${2:-}" ;;
  restore) cmd_restore "${2:-}" ;;
  clean)   cmd_clean "${2:-}" ;;
  *)
    echo "Usage: checkpoint.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  save [description]   Save current state as checkpoint"
    echo "  list                 List all checkpoints"
    echo "  show [id]            Show checkpoint details (default: latest)"
    echo "  restore [id]         Restore from checkpoint (default: latest)"
    echo "  clean [keep]         Remove old checkpoints (default: keep 10)"
    ;;
esac
