#!/usr/bin/env bash
# Upload a project's masters to the studio's case-study Drive folder, one folder per project, and print that folder's URL
# (the board links to it). Re-running sends only new files; a file that changed since the last upload stops the run instead of
# overwriting it (rclone --immutable), so nobody's file is replaced. Remove the remote copy by hand to replace it on purpose.
# usage: drive_upload.sh <masters_dir> "<Project name>"      e.g. drive_upload.sh ../acme-case-study-assets "Acme - Launch"
# env:   CASE_STUDY_DRIVE_ROOT    required: URL or id of the studio's "Website - Case Study - Assets" folder. It is not in this public
#                                 repo; ask the studio for it
#        CASE_STUDY_RCLONE_REMOTE rclone remote name (default gdrive)
# needs: rclone with a Drive remote, set up once with `rclone config create gdrive drive scope=drive` (browser sign-in).
#        drive.file scope can't see folders other people created, so use scope=drive.
#        No rclone? Homebrew may have no bottle for an older macOS (it then tries to compile and fails): download the official binary from
#        downloads.rclone.org, check it against that release's SHA256SUMS, and put it in ~/.local/bin. rclone's shared Google client ID is
#        being retired; if Google refuses the sign-in, create a Drive OAuth client ID and pass client_id/client_secret to `rclone config create`.
set -euo pipefail
SRC=${1:?masters dir}; NAME=${2:?project name}
ROOT=${CASE_STUDY_DRIVE_ROOT:?set CASE_STUDY_DRIVE_ROOT to the case-study Drive root folder URL or id}
ROOT=${ROOT##*/folders/}; ROOT=${ROOT%%\?*}
R=${CASE_STUDY_RCLONE_REMOTE:-gdrive}
RC=$(command -v rclone || echo "$HOME/.local/bin/rclone")
A=(--drive-root-folder-id "$ROOT")

# reuse an existing project folder (name match ignoring case), otherwise create one with the given name
DIR=$("$RC" lsf "$R:" "${A[@]}" --dirs-only | sed 's:/$::' | awk -v n="$NAME" 'tolower($0) == tolower(n)' | head -1)
DIR=${DIR:-$NAME}
# _toolkit holds project code and stays local; everything else is a master
"$RC" copy "$SRC" "$R:$DIR" "${A[@]}" --exclude "_toolkit/**" --exclude ".DS_Store" --immutable --transfers 8 --stats 30s --stats-one-line
ID=$("$RC" lsjson "$R:" "${A[@]}" --dirs-only | python3 -c 'import json, sys; print(next(d["ID"] for d in json.load(sys.stdin) if d["Name"] == sys.argv[1]))' "$DIR")
echo "https://drive.google.com/drive/folders/$ID"
