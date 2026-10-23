#!/bin/bash
# Contact sheet for eyeballing a capture before trusting it. usage: sheet.sh <video|"glob of images"> <out.jpg> [every_n_frames=60] [cols=4]
# Rows grow to fit every sampled frame (an image sequence is sampled the same way as a video).
N=${3:-60}; C=${4:-4}
if [[ "$1" == *.mp4 || "$1" == *.mov ]]; then IN=(-i "$1"); TOTAL=$(ffprobe -v error -count_packets -select_streams v:0 -show_entries stream=nb_read_packets -of csv=p=0 "$1" | tr -dc 0-9)
else IN=(-pattern_type glob -i "$1"); TOTAL=$(compgen -G "$1" | wc -l); fi
R=$(( ( (TOTAL + N - 1) / N + C - 1 ) / C )); (( R < 1 )) && R=1
ffmpeg -nostdin -v error -y "${IN[@]}" -vf "select='not(mod(n,$N))',scale=480:-1,tile=${C}x${R}:padding=4" -frames:v 1 "$2"
