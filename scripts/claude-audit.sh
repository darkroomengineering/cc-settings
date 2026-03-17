#!/bin/bash
# Claude bash command audit — categorized command analysis.
# Reads logs from ~/.claude/logs/bash-YYYY-MM-DD.log
# Format: [HH:MM:SS] [project] command

LOG_DIR="$HOME/.claude/logs"

pad_bar() {
  local val=$1 mx=$2 w=${3:-12}
  local filled=0
  if [ "$mx" -gt 0 ]; then
    filled=$(( val * w / mx ))
  fi
  local out=""
  for ((i=0; i<filled; i++)); do out+="█"; done
  printf "%-${w}s" "$out"
}

# Classify a command → "group:detail"
classify() {
  local cmd="$1"

  # git — group:subcommand
  if echo "$cmd" | grep -qE '^\s*git\b'; then
    local sub
    sub=$(echo "$cmd" | sed -n 's/.*git[[:space:]]\{1,\}\([a-z-]*\).*/\1/p')
    echo "git:$sub"
    return
  fi

  # python inline
  if echo "$cmd" | grep -qE '^\s*python3?\s+-c\b'; then
    echo "python:inline script"
    return
  fi

  # python script file
  if echo "$cmd" | grep -qE '^\s*python3?\s+[^-]'; then
    local script
    script=$(echo "$cmd" | sed -n 's/.*python3\{0,1\}[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p')
    script=$(basename "$script" 2>/dev/null)
    echo "python:$script"
    return
  fi

  # bun run task
  if echo "$cmd" | grep -qE '^\s*bun\s+run\b'; then
    local task
    task=$(echo "$cmd" | sed -n 's/.*bun run[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p')
    echo "bun:run $task"
    return
  fi

  # bun/bunx/node/npx/npm
  if echo "$cmd" | grep -qE '^\s*(bunx|npx)\b'; then
    local pkg
    pkg=$(echo "$cmd" | awk '{print $2}')
    echo "node:$(echo "$cmd" | awk '{print $1}') $pkg"
    return
  fi
  if echo "$cmd" | grep -qE '^\s*(bun|node|npm)\b'; then
    local sub
    sub=$(echo "$cmd" | awk '{print $1" "$2}')
    echo "node:$sub"
    return
  fi

  # bash running a script
  if echo "$cmd" | grep -qE '^\s*bash\s+[^-]'; then
    local script
    script=$(echo "$cmd" | sed -n 's/.*bash[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p')
    script=$(basename "$script" 2>/dev/null)
    echo "bash:$script"
    return
  fi
  if echo "$cmd" | grep -qE '^\s*bash\s+-c\b'; then
    echo "bash:inline script"
    return
  fi

  # file read
  if echo "$cmd" | grep -qE '^\s*(cat|head|tail|less|more|wc)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    echo "file:$tool"
    return
  fi
  # file list
  if echo "$cmd" | grep -qE '^\s*(ls|tree)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    echo "file:$tool"
    return
  fi
  # file modify
  if echo "$cmd" | grep -qE '^\s*(cp|mv|mkdir|touch|chmod|chown)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    echo "file:$tool"
    return
  fi
  # file delete
  if echo "$cmd" | grep -qE '^\s*rm\b'; then
    echo "file:rm"
    return
  fi

  # search
  if echo "$cmd" | grep -qE '^\s*(find|grep|rg|ag|fd)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    echo "search:$tool"
    return
  fi

  # network
  if echo "$cmd" | grep -qE '^\s*(curl|wget|ssh|scp|rsync)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    tool=$(basename "$tool" 2>/dev/null)
    echo "net:$tool"
    return
  fi

  # system
  if echo "$cmd" | grep -qE '^\s*(echo|printf|date|whoami|hostname|uname|env|defaults|pmset|sw_vers|ioreg)\b'; then
    local tool
    tool=$(echo "$cmd" | awk '{print $1}')
    echo "system:$tool"
    return
  fi

  # docker
  if echo "$cmd" | grep -qE '^\s*(docker|podman|docker-compose)\b'; then
    local sub
    sub=$(echo "$cmd" | awk '{print $1" "$2}')
    echo "docker:$sub"
    return
  fi

  # fallback
  local first
  first=$(echo "$cmd" | awk '{print $1}')
  first=$(basename "$first" 2>/dev/null)
  echo "other:$first"
}

analyze() {
  local label="$1"
  shift
  local all_lines=""

  for f in "$@"; do
    [ -f "$f" ] && all_lines+="$(cat "$f")"$'\n'
  done

  all_lines=$(echo "$all_lines" | sed '/^$/d')

  local total
  total=$(echo "$all_lines" | wc -l | tr -d ' ')
  if [ "$total" -eq 0 ] || [ -z "$all_lines" ]; then
    echo "  $label: no data"
    return
  fi

  echo "  $label ($total commands)"

  # Classify each command
  local classifications=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local cmd
    cmd=$(echo "$line" | sed 's/^\[[^]]*\] \[[^]]*\] //')
    classifications+="$(classify "$cmd")"$'\n'
  done <<< "$all_lines"

  classifications=$(echo "$classifications" | sed '/^$/d')

  # Get group totals for sorting groups
  local group_totals
  group_totals=$(echo "$classifications" | sed 's/:.*//' | sort | uniq -c | sort -rn)

  # Global max for bars
  local global_max
  global_max=$(echo "$group_totals" | head -1 | awk '{print $1}')

  # For each group, show header + details
  echo "$group_totals" | while read -r gcount gname; do
    [ -z "$gname" ] && continue
    echo
    printf "  %-24s  %s  %s\n" "$gname" "$(pad_bar "$gcount" "$global_max")" "$gcount"

    # Details within this group
    local details
    details=$(echo "$classifications" | grep "^${gname}:" | sed "s/^${gname}://" | sort | uniq -c | sort -rn)

    local dmax
    dmax=$(echo "$details" | head -1 | awk '{print $1}')

    echo "$details" | head -6 | while read -r dcount dname; do
      [ -z "$dname" ] && continue
      printf "    %-22s  %s  %s\n" "$dname" "$(pad_bar "$dcount" "$dmax" 8)" "$dcount"
    done
  done

  # Project distribution
  local proj_freq
  proj_freq=$(echo "$all_lines" | sed -n 's/^\[[^]]*\] \[\([^]]*\)\].*/\1/p' | sort | uniq -c | sort -rn)

  if [ -n "$proj_freq" ]; then
    echo
    echo "  projects"
    local pmax
    pmax=$(echo "$proj_freq" | head -1 | awk '{print $1}')
    echo "$proj_freq" | while read -r count name; do
      [ -z "$name" ] && continue
      printf "    %-22s  %s  %s\n" "$name" "$(pad_bar "$count" "$pmax" 8)" "$count"
    done
  fi

  # Security scan
  local flags=""
  local flag_count=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local time cmd desc=""
    time=$(echo "$line" | sed -n 's/^\[\([0-9:]*\)\].*/\1/p')
    cmd=$(echo "$line" | sed 's/^\[[^]]*\] \[[^]]*\] //')

    if echo "$cmd" | grep -qiE 'curl.*\|\s*(ba)?sh'; then desc="piping curl to shell"
    elif echo "$cmd" | grep -qiE '\bsudo\b'; then desc="sudo usage"
    elif echo "$cmd" | grep -qiE '\brm\s+-rf\b'; then desc="recursive force delete"
    elif echo "$cmd" | grep -qiE '~/\.ssh|~/\.aws|~/\.gnupg|~/\.env'; then desc="touching sensitive paths"
    elif echo "$cmd" | grep -qiE '\bchmod\s+777\b'; then desc="world-writable permissions"
    elif echo "$cmd" | grep -qiE 'password=|secret=|token=|api.key='; then desc="possible credential in command"
    elif echo "$cmd" | grep -qiE '\bscp\b|rsync.*@'; then desc="remote file transfer"
    elif echo "$cmd" | grep -qiE 'git\s+push\s+--force|git\s+push\s+-f'; then desc="force push"
    elif echo "$cmd" | grep -qiE 'git\s+reset\s+--hard'; then desc="hard reset"
    fi

    if [ -n "$desc" ]; then
      flags+="    [$time] $desc"$'\n'
      flags+="           ${cmd:0:70}"$'\n'
      flag_count=$((flag_count + 1))
    fi
  done <<< "$all_lines"

  echo
  if [ "$flag_count" -gt 0 ]; then
    echo "  ⚠ security ($flag_count flags)"
    echo "$flags" | head -10
  else
    echo "  ✓ no security concerns"
  fi

  # Repeated exact commands (3+)
  local repeats
  repeats=$(echo "$all_lines" | sed 's/^\[[^]]*\] \[[^]]*\] //' | sort | uniq -c | sort -rn | awk '$1 >= 3' | head -5)

  if [ -n "$repeats" ]; then
    echo
    echo "  ↻ repeated (optimization candidates)"
    echo "$repeats" | while read -r count cmd; do
      echo "    ${count}x  ${cmd:0:55}"
    done
  fi
}

main() {
  local today
  today=$(date +%Y-%m-%d)

  echo "🔍 Claude Audit · $(date '+%a %b %d · %H:%M')"
  echo

  # Today
  analyze "Today" "$LOG_DIR/bash-${today}.log"

  # Week — collect log files from Monday to today
  local dow
  dow=$(date +%u)  # 1=Monday, 7=Sunday
  local week_files=()
  for ((d=0; d<7; d++)); do
    local day_file
    day_file=$(date -v-$((dow - 1))d -v+${d}d +%Y-%m-%d 2>/dev/null)
    if [ -z "$day_file" ]; then continue; fi
    if [[ "$day_file" > "$today" ]]; then continue; fi
    local f="$LOG_DIR/bash-${day_file}.log"
    if [ -f "$f" ]; then
      week_files+=("$f")
    fi
  done

  if [ ${#week_files[@]} -gt 1 ]; then
    echo
    analyze "This week" "${week_files[@]}"
  fi

  echo
}

main "$@"
