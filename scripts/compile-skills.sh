#!/bin/bash
# Compile Skills Index
# Scans all SKILL.md files and creates a fast-lookup index
# Format: PATTERN|SKILL_NAME|PRIORITY|ENFORCEMENT|AGENTS

set -e

CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
COMPILED_INDEX="${CLAUDE_DIR}/skill-index.compiled"
COMPILED_CHECKSUM="${CLAUDE_DIR}/skill-index.checksum"

# Source shared library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/../lib"
if [[ -f "${LIB_DIR}/colors.sh" ]]; then
    source "${LIB_DIR}/colors.sh"
    log_info() { info "$1"; }
    log_warn() { warn "$1"; }
    log_error() { error "$1"; }
else
    # Fallback if lib not available
    log_info() { echo "[INFO] $1"; }
    log_warn() { echo "[WARN] $1"; }
    log_error() { echo "[ERROR] $1"; }
fi

# Source shared skill patterns
if [[ -f "${LIB_DIR}/skill-patterns.sh" ]]; then
    source "${LIB_DIR}/skill-patterns.sh"
fi

# Check if skills directory exists
if [[ ! -d "$SKILLS_DIR" ]]; then
    log_error "Skills directory not found: $SKILLS_DIR"
    exit 1
fi

# Compute checksum of all SKILL.md files to detect changes
compute_checksum() {
    find "$SKILLS_DIR" -name "SKILL.md" -type f -exec cat {} \; 2>/dev/null | md5 2>/dev/null || \
    find "$SKILLS_DIR" -name "SKILL.md" -type f -exec cat {} \; 2>/dev/null | md5sum 2>/dev/null | cut -d' ' -f1
}

# Check if recompilation is needed
needs_recompile() {
    # Always recompile if index doesn't exist
    [[ ! -f "$COMPILED_INDEX" ]] && return 0

    # Always recompile if checksum file doesn't exist
    [[ ! -f "$COMPILED_CHECKSUM" ]] && return 0

    # Compare checksums
    local current_checksum
    current_checksum=$(compute_checksum)
    local stored_checksum
    stored_checksum=$(cat "$COMPILED_CHECKSUM" 2>/dev/null)

    [[ "$current_checksum" != "$stored_checksum" ]]
}

# Extract name from YAML frontmatter
extract_name() {
    local file="$1"
    grep -m1 "^name:" "$file" 2>/dev/null | sed 's/^name:[[:space:]]*//' | tr -d '"' | tr -d "'"
}

# Extract description from YAML frontmatter
extract_description() {
    local file="$1"
    # Multi-line description - get first line after "description: |"
    sed -n '/^description:/,/^[a-z]/{/^description:/d;/^[a-z]/d;p;}' "$file" 2>/dev/null | head -3 | tr '\n' ' ' | sed 's/^[[:space:]]*//'
}

# Extract agent from YAML frontmatter
extract_agent() {
    local file="$1"
    grep -m1 "^agent:" "$file" 2>/dev/null | sed 's/^agent:[[:space:]]*//' | tr -d '"' | tr -d "'"
}

# Generate trigger patterns from skill name and description
generate_patterns() {
    local skill_name="$1"
    local description="$2"
    local patterns=()

    # Add skill name itself
    patterns+=("$skill_name")

    # Get patterns from shared mapping
    if type get_skill_patterns &>/dev/null; then
        while IFS= read -r p; do
            [[ -n "$p" ]] && patterns+=("$p")
        done < <(get_skill_patterns "$skill_name")
    fi

    # If no patterns from shared mapping and we have a description, extract from it
    if [[ ${#patterns[@]} -le 1 ]] && [[ -n "$description" ]]; then
        # Extract quoted strings from description as patterns
        while read -r pattern; do
            [[ -n "$pattern" ]] && patterns+=("$pattern")
        done < <(echo "$description" | grep -oE '"[^"]+"' | tr -d '"')
    fi

    # Output patterns (deduplicated)
    printf '%s\n' "${patterns[@]}" | sort -u
}

# Determine priority based on skill (delegates to shared lib)
get_priority() {
    local skill_name="$1"
    if type get_skill_priority &>/dev/null; then
        get_skill_priority "$skill_name"
    else
        echo "low"
    fi
}

# Determine enforcement based on skill (delegates to shared lib)
get_enforcement() {
    local skill_name="$1"
    if type get_skill_enforcement &>/dev/null; then
        get_skill_enforcement "$skill_name"
    else
        echo "suggest"
    fi
}

# Get default agents for skill (delegates to shared lib)
get_agents() {
    local skill_name="$1"
    if type get_skill_agents &>/dev/null; then
        get_skill_agents "$skill_name"
    else
        echo ""
    fi
}

# Main compilation function
compile_index() {
    log_info "Compiling skill index..."

    local temp_index="${COMPILED_INDEX}.tmp"
    local skill_count=0
    local pattern_count=0

    # Write header
    cat > "$temp_index" << 'EOF'
# Skill Index - Auto-generated
# Do not edit manually - run compile-skills.sh to regenerate
# Format: PATTERN|SKILL_NAME|PRIORITY|ENFORCEMENT|AGENTS
# Patterns are case-insensitive regex
#
EOF
    echo "# Generated: $(date '+%Y-%m-%d %H:%M:%S')" >> "$temp_index"
    echo "#" >> "$temp_index"

    # Process each SKILL.md file
    while IFS= read -r -d '' skill_file; do
        local skill_name
        skill_name=$(extract_name "$skill_file")

        if [[ -z "$skill_name" ]]; then
            log_warn "No name found in: $skill_file"
            continue
        fi

        local description
        description=$(extract_description "$skill_file")

        local agent
        agent=$(extract_agent "$skill_file")

        local priority
        priority=$(get_priority "$skill_name")

        local enforcement
        enforcement=$(get_enforcement "$skill_name")

        local agents
        agents=$(get_agents "$skill_name")
        # Override with explicit agent if specified
        [[ -n "$agent" ]] && agents="$agent"

        skill_count=$((skill_count + 1))

        # Generate and write patterns
        while IFS= read -r pattern; do
            if [[ -n "$pattern" ]]; then
                echo "${pattern}|${skill_name}|${priority}|${enforcement}|${agents}" >> "$temp_index"
                pattern_count=$((pattern_count + 1))
            fi
        done < <(generate_patterns "$skill_name" "$description")

    done < <(find "$SKILLS_DIR" -name "SKILL.md" -type f -print0 2>/dev/null)

    # Move temp to final
    mv "$temp_index" "$COMPILED_INDEX"

    # Store checksum
    compute_checksum > "$COMPILED_CHECKSUM"

    log_info "Compiled $pattern_count patterns from $skill_count skills"
    log_info "Index written to: $COMPILED_INDEX"
}

# Check if force flag is set
FORCE_COMPILE=false
if [[ "$1" == "--force" ]] || [[ "$1" == "-f" ]]; then
    FORCE_COMPILE=true
fi

# Main execution
if [[ "$FORCE_COMPILE" == true ]] || needs_recompile; then
    compile_index
else
    log_info "Skill index is up to date (use --force to recompile)"
fi
