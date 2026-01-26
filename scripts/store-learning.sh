#!/bin/bash
# Store Learning Script (Legacy wrapper)
# Delegates to unified learning.sh script
exec "$(dirname "$0")/learning.sh" store "$@"
