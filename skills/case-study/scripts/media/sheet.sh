#!/bin/bash
# Contact sheet for eyeballing a capture before trusting it. usage: sheet.sh <video|"glob of images"> <out.jpg> [every_n_frames=60] [cols=4]
if [[ "$1" == *.mp4 || "$1" == *.mov ]]; then ffmpeg -v error -y -i "$1" -vf "select='not(mod(n,${3:-60}))',scale=480:-1,tile=${4:-4}x4:padding=4" -frames:v 1 "$2"
else ffmpeg -v error -y -pattern_type glob -i "$1" -vf "scale=480:-1,tile=${4:-4}x4:padding=4" -frames:v 1 "$2"; fi
