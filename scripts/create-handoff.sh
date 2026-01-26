#!/bin/bash
# Create Handoff Script (legacy wrapper)
# Delegates to unified handoff.sh

exec "$(dirname "$0")/handoff.sh" create "$@"
