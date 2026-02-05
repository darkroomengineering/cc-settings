#!/usr/bin/env bash

# Read JSON input from stdin
input=$(cat)

# Extract values
model=$(echo "$input" | jq -r '.model.display_name')
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
tokens_available=$(echo "$input" | jq -r '.context_window.context_window_size')
# Calculate current context usage from percentage (not cumulative totals)
tokens_used=$(awk "BEGIN {printf \"%.0f\", ${tokens_available:-0} * ${used:-0} / 100}")

# Get basename of current directory
dir_name=$(basename "$current_dir")

# Get git branch and status (skip optional locks)
git_branch=""
git_status=""
if git -C "$current_dir" rev-parse --git-dir > /dev/null 2>&1; then
  git_branch=$(git -C "$current_dir" --no-optional-locks branch --show-current 2>/dev/null)

  if [ -n "$git_branch" ]; then
    # ANSI color codes
    cyan="\033[36m"
    yellow="\033[33m"
    reset="\033[0m"

    # Check for uncommitted changes (dirty working tree)
    dirty=""
    if ! git -C "$current_dir" --no-optional-locks diff --quiet 2>/dev/null || \
       ! git -C "$current_dir" --no-optional-locks diff --cached --quiet 2>/dev/null; then
      dirty=$(printf "${yellow}✱${reset}")
    fi

    # Check for unpushed/unpulled commits
    upstream=""
    remote_branch=$(git -C "$current_dir" --no-optional-locks rev-parse --abbrev-ref @{upstream} 2>/dev/null)
    if [ -n "$remote_branch" ]; then
      # Count commits ahead/behind
      ahead=$(git -C "$current_dir" --no-optional-locks rev-list --count @{upstream}..HEAD 2>/dev/null || echo "0")
      behind=$(git -C "$current_dir" --no-optional-locks rev-list --count HEAD..@{upstream} 2>/dev/null || echo "0")

      if [ "$ahead" -gt 0 ]; then
        upstream="${upstream}↑"
      fi
      if [ "$behind" -gt 0 ]; then
        upstream="${upstream}↓"
      fi
    fi

    # Build the styled git status string
    git_status=$(printf "${cyan}%s${reset}%s%s" "$git_branch" "$dirty" "$upstream")
  fi
fi

# Build status line parts
parts=()

# 1. Model in use
parts+=("$model")

# 2. Current directory name
parts+=("$dir_name")

# 3. Git branch with status (if in a git repo)
if [ -n "$git_status" ]; then
  parts+=("$git_status")
fi

# 4. Context progress bar with percentage
if [ -n "$used" ]; then
  used_int=$(printf "%.0f" "$used")

  # Create progress bar (10 blocks total)
  filled_blocks=$((used_int / 10))
  empty_blocks=$((10 - filled_blocks))

  # Build progress bar with filled (█) and empty (░) blocks
  progress_bar=""
  for ((i=0; i<filled_blocks; i++)); do
    progress_bar+="█"
  done
  for ((i=0; i<empty_blocks; i++)); do
    progress_bar+="░"
  done

  # Format tokens: use "M" suffix when above 500K, otherwise "k"
  if [ "${tokens_used:-0}" -gt 500000 ] 2>/dev/null; then
    tokens_used_fmt=$(awk "BEGIN {printf \"%.1fM\", ${tokens_used}/1000000}")
  else
    tokens_used_fmt=$(awk "BEGIN {printf \"%.0fk\", ${tokens_used}/1000}")
  fi

  if [ "${tokens_available:-0}" -gt 500000 ] 2>/dev/null; then
    tokens_available_fmt=$(awk "BEGIN {printf \"%.1fM\", ${tokens_available}/1000000}")
  else
    tokens_available_fmt=$(awk "BEGIN {printf \"%.0fk\", ${tokens_available}/1000}")
  fi

  parts+=("${progress_bar} ${used_int}% (${tokens_used_fmt}/${tokens_available_fmt})")
fi

# Join with dimmed separator and print
# Using printf for ANSI color codes
separator=$(printf "\033[2m | \033[0m")
first=true
for part in "${parts[@]}"; do
  if [ "$first" = true ]; then
    printf "%s" "$part"
    first=false
  else
    printf "%s%s" "$separator" "$part"
  fi
done
printf "\n"
