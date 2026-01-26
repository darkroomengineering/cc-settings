#!/bin/bash
# Delete Learning Script (Legacy wrapper)
# Delegates to unified learning.sh script
exec "$(dirname "$0")/learning.sh" delete "$@"
