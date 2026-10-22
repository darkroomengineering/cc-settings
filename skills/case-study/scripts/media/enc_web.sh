#!/bin/bash
# 720p web encode + poster frame, for the board (artifact files must stay under 15 MB each). usage: enc_web.sh in.mp4 out.mp4 [crf=24] [posterSeconds=0.5]
ffmpeg -v error -y -i "$1" -vf "scale=1280:-2:flags=lanczos" -c:v libx264 -preset slow -crf ${3:-24} -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k "$2"
ffmpeg -v error -y -ss ${4:-0.5} -i "$2" -frames:v 1 -q:v 4 "${2%.mp4}.jpg"
