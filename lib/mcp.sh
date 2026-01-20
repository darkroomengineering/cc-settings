#!/bin/bash
# lib/mcp.sh - MCP server detection, preservation, and merging
# Part of Darkroom Claude Code Setup

# Global MCP state
declare -a USER_MCP_SERVERS=()        # All servers in user's existing config
declare -a TEAM_MCP_SERVERS=()        # All servers in team config
declare -a USER_ONLY_SERVERS=()       # Servers only in user config (not in team)
declare -a PRESERVED_SERVERS=()       # User servers to preserve during merge

# MCP preservation mode
PRESERVE_MCP=true

# Extract MCP server names from a settings.json file
# Usage: extract_mcp_servers "/path/to/settings.json"
# Sets: MCP_SERVERS array
extract_mcp_servers() {
    local settings_file="$1"
    local -a servers=()

    if [[ ! -f "$settings_file" ]]; then
        echo ""
        return 1
    fi

    # Extract mcpServers keys using jq
    local keys
    keys=$(jq -r '.mcpServers // {} | keys[]' "$settings_file" 2>/dev/null)

    if [[ -n "$keys" ]]; then
        while IFS= read -r server; do
            servers+=("$server")
        done <<< "$keys"
    fi

    # Return space-separated list
    echo "${servers[*]}"
}

# Get MCP server config as JSON
# Usage: get_mcp_server_config "/path/to/settings.json" "server_name"
get_mcp_server_config() {
    local settings_file="$1"
    local server_name="$2"

    if [[ ! -f "$settings_file" ]]; then
        echo "{}"
        return 1
    fi

    jq ".mcpServers.\"$server_name\" // {}" "$settings_file" 2>/dev/null || echo "{}"
}

# List MCP server names (formatted for display)
# Usage: list_mcp_server_names "server1" "server2" ...
list_mcp_server_names() {
    local servers=("$@")

    for server in "${servers[@]}"; do
        echo "  - $server"
    done
}

# Find servers that are only in user config (not in team config)
# Usage: find_user_only_servers
# Requires: USER_MCP_SERVERS and TEAM_MCP_SERVERS to be set
find_user_only_servers() {
    USER_ONLY_SERVERS=()

    for user_server in "${USER_MCP_SERVERS[@]}"; do
        local found=false
        for team_server in "${TEAM_MCP_SERVERS[@]}"; do
            if [[ "$user_server" == "$team_server" ]]; then
                found=true
                break
            fi
        done
        if [[ "$found" == false ]]; then
            USER_ONLY_SERVERS+=("$user_server")
        fi
    done
}

# Interactive prompt to select which user MCP servers to preserve
# Usage: prompt_mcp_preservation
# Sets: PRESERVED_SERVERS array
prompt_mcp_preservation() {
    if [[ ${#USER_ONLY_SERVERS[@]} -eq 0 ]]; then
        debug "No user-only MCP servers to preserve"
        return 0
    fi

    local count=${#USER_ONLY_SERVERS[@]}

    echo ""
    info "You have ${count} custom MCP server(s) not in the team config:"
    echo ""
    list_mcp_server_names "${USER_ONLY_SERVERS[@]}"
    echo ""

    if [[ "$INTERACTIVE" == true ]]; then
        if prompt_yn "Keep these servers? (they'll be merged with team config)" "y"; then
            PRESERVED_SERVERS=("${USER_ONLY_SERVERS[@]}")
            success "Keeping all ${count} custom server(s)"
        else
            PRESERVED_SERVERS=()
            info "Starting fresh (custom servers will not be kept)"
        fi
    else
        # Non-interactive: preserve all by default
        PRESERVED_SERVERS=("${USER_ONLY_SERVERS[@]}")
        info "Keeping all custom MCP servers (non-interactive mode)"
    fi
}

# Merge user MCP servers into team settings
# Usage: merge_mcp_configs "team_settings.json" "user_settings.json" "output_file"
merge_mcp_configs() {
    local team_file="$1"
    local user_file="$2"
    local output_file="$3"

    # Start with team config
    local merged
    merged=$(cat "$team_file")

    # If no servers to preserve, just use team config
    if [[ ${#PRESERVED_SERVERS[@]} -eq 0 ]]; then
        echo "$merged" > "$output_file"
        return 0
    fi

    # Merge each preserved server
    for server in "${PRESERVED_SERVERS[@]}"; do
        local server_config
        server_config=$(get_mcp_server_config "$user_file" "$server")

        if [[ "$server_config" != "{}" ]] && [[ -n "$server_config" ]]; then
            debug "Merging MCP server: $server"
            merged=$(echo "$merged" | jq --arg name "$server" --argjson config "$server_config" '.mcpServers[$name] = $config')
        fi
    done

    # Write merged config
    echo "$merged" | jq '.' > "$output_file"
}

# Detect existing MCP configuration
# Usage: detect_existing_mcp "/path/to/existing/settings.json" "/path/to/team/settings.json"
detect_existing_mcp() {
    local existing_file="$1"
    local team_file="$2"

    # Extract server lists
    local user_list team_list

    user_list=$(extract_mcp_servers "$existing_file")
    team_list=$(extract_mcp_servers "$team_file")

    # Convert to arrays
    USER_MCP_SERVERS=()
    TEAM_MCP_SERVERS=()

    if [[ -n "$user_list" ]]; then
        read -ra USER_MCP_SERVERS <<< "$user_list"
    fi

    if [[ -n "$team_list" ]]; then
        read -ra TEAM_MCP_SERVERS <<< "$team_list"
    fi

    # Find user-only servers
    find_user_only_servers

    debug "User MCP servers: ${USER_MCP_SERVERS[*]}"
    debug "Team MCP servers: ${TEAM_MCP_SERVERS[*]}"
    debug "User-only servers: ${USER_ONLY_SERVERS[*]}"
}

# Main MCP handling workflow
# Usage: handle_mcp_preservation "existing_settings" "team_settings" "output_settings"
handle_mcp_preservation() {
    local existing_file="$1"
    local team_file="$2"
    local output_file="$3"

    # Skip if preservation is disabled
    if [[ "$PRESERVE_MCP" != true ]]; then
        debug "MCP preservation disabled, using team config as-is"
        cp "$team_file" "$output_file"
        return 0
    fi

    # Skip if no existing config
    if [[ ! -f "$existing_file" ]]; then
        debug "No existing settings.json, using team config"
        cp "$team_file" "$output_file"
        return 0
    fi

    # Detect existing MCP servers
    detect_existing_mcp "$existing_file" "$team_file"

    # If user has custom servers, prompt for preservation
    if [[ ${#USER_ONLY_SERVERS[@]} -gt 0 ]]; then
        prompt_mcp_preservation
        merge_mcp_configs "$team_file" "$existing_file" "$output_file"
    else
        debug "No user-only MCP servers, using team config"
        cp "$team_file" "$output_file"
    fi
}

# Show MCP server summary
show_mcp_summary() {
    local settings_file="$1"

    if [[ ! -f "$settings_file" ]]; then
        return 1
    fi

    box_start "MCP Servers"

    # Get all servers
    local servers
    servers=$(extract_mcp_servers "$settings_file")

    if [[ -z "$servers" ]]; then
        box_line "" "No MCP servers configured"
    else
        read -ra server_array <<< "$servers"
        for server in "${server_array[@]}"; do
            # Check if server has required command/url
            local server_config
            server_config=$(get_mcp_server_config "$settings_file" "$server")

            local has_command has_url
            has_command=$(echo "$server_config" | jq -r '.command // empty' 2>/dev/null)
            has_url=$(echo "$server_config" | jq -r '.url // empty' 2>/dev/null)

            if [[ -n "$has_command" ]] || [[ -n "$has_url" ]]; then
                box_line "ok" "$server"
            else
                box_line "warn" "$server (needs configuration)"
            fi
        done

        # Note preserved servers
        if [[ ${#PRESERVED_SERVERS[@]} -gt 0 ]]; then
            echo "|-------------------------------------------|"
            echo "| Preserved from your config:               |"
            for server in "${PRESERVED_SERVERS[@]}"; do
                printf "| * %-39s |\n" "$server"
            done
        fi
    fi

    box_end
}

# Compare two MCP configs and show diff
diff_mcp_servers() {
    local file1="$1"
    local file2="$2"

    local servers1 servers2
    servers1=$(extract_mcp_servers "$file1")
    servers2=$(extract_mcp_servers "$file2")

    echo "File 1 servers: $servers1"
    echo "File 2 servers: $servers2"

    # Find differences
    local in_1_only="" in_2_only="" in_both=""

    read -ra arr1 <<< "$servers1"
    read -ra arr2 <<< "$servers2"

    for s in "${arr1[@]}"; do
        local found=false
        for t in "${arr2[@]}"; do
            [[ "$s" == "$t" ]] && found=true && break
        done
        if [[ "$found" == true ]]; then
            in_both="$in_both $s"
        else
            in_1_only="$in_1_only $s"
        fi
    done

    for s in "${arr2[@]}"; do
        local found=false
        for t in "${arr1[@]}"; do
            [[ "$s" == "$t" ]] && found=true && break
        done
        if [[ "$found" == false ]]; then
            in_2_only="$in_2_only $s"
        fi
    done

    echo ""
    echo "In both:$in_both"
    echo "Only in file 1:$in_1_only"
    echo "Only in file 2:$in_2_only"
}

# =============================================================================
# CLAUDE.JSON MCP INSTALLATION
# =============================================================================
# Claude Code reads MCP servers from ~/.claude.json, NOT ~/.claude/settings.json
# This section handles installing MCP servers to the correct location.

CLAUDE_JSON_FILE="${HOME}/.claude.json"

# Extract MCP servers from ~/.claude.json (different structure than settings.json)
# In claude.json, mcpServers can be at root level or per-project
extract_claude_json_mcp() {
    if [[ ! -f "$CLAUDE_JSON_FILE" ]]; then
        echo ""
        return 1
    fi

    # Get root-level mcpServers
    local keys
    keys=$(jq -r '.mcpServers // {} | keys[]' "$CLAUDE_JSON_FILE" 2>/dev/null)
    echo "$keys" | tr '\n' ' ' | sed 's/ $//'
}

# Install MCP servers to ~/.claude.json (where Claude Code actually reads them)
# Usage: install_mcp_to_claude_json "team_settings.json"
install_mcp_to_claude_json() {
    local team_settings="$1"

    if [[ ! -f "$team_settings" ]]; then
        warn "Team settings not found: $team_settings"
        return 1
    fi

    # Extract MCP servers from team settings
    local team_mcp
    team_mcp=$(jq '.mcpServers // {}' "$team_settings" 2>/dev/null)

    if [[ "$team_mcp" == "{}" ]] || [[ -z "$team_mcp" ]]; then
        debug "No MCP servers in team config"
        return 0
    fi

    # Create claude.json if it doesn't exist
    if [[ ! -f "$CLAUDE_JSON_FILE" ]]; then
        echo '{}' > "$CLAUDE_JSON_FILE"
    fi

    # Read existing claude.json
    local existing_json
    existing_json=$(cat "$CLAUDE_JSON_FILE")

    # Get existing root-level mcpServers (preserve user's custom servers)
    local existing_mcp
    existing_mcp=$(echo "$existing_json" | jq '.mcpServers // {}' 2>/dev/null)

    # Merge: team servers + existing user servers (user servers take precedence for conflicts)
    # This means team provides base, user can override
    local merged_mcp
    merged_mcp=$(echo "$team_mcp" "$existing_mcp" | jq -s '.[0] * .[1]' 2>/dev/null)

    # Update claude.json with merged mcpServers
    local updated_json
    updated_json=$(echo "$existing_json" | jq --argjson mcp "$merged_mcp" '.mcpServers = $mcp' 2>/dev/null)

    if [[ -n "$updated_json" ]]; then
        echo "$updated_json" | jq '.' > "$CLAUDE_JSON_FILE"
        debug "Installed MCP servers to ~/.claude.json"
        return 0
    else
        warn "Failed to update ~/.claude.json"
        return 1
    fi
}

# Show MCP servers installed in ~/.claude.json
show_claude_json_mcp() {
    if [[ ! -f "$CLAUDE_JSON_FILE" ]]; then
        return 1
    fi

    local servers
    servers=$(extract_claude_json_mcp)

    if [[ -z "$servers" ]]; then
        return 1
    fi

    box_start "MCP Servers (active)"

    read -ra server_array <<< "$servers"
    for server in "${server_array[@]}"; do
        local server_config
        server_config=$(jq ".mcpServers.\"$server\" // {}" "$CLAUDE_JSON_FILE" 2>/dev/null)

        local has_command has_url
        has_command=$(echo "$server_config" | jq -r '.command // empty' 2>/dev/null)
        has_url=$(echo "$server_config" | jq -r '.url // empty' 2>/dev/null)

        if [[ -n "$has_command" ]] || [[ -n "$has_url" ]]; then
            box_line "ok" "$server"
        else
            box_line "warn" "$server (invalid config)"
        fi
    done

    box_end
}
