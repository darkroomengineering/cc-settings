#!/bin/bash
# Every sound as its own files: original, a copy raised to -1 dB peak (site stems are often mastered ~-25 dB), a waveform and a spectrogram (16:9).
# usage: export_sounds.sh <sounds_dir> <out_dir> [accent=#ffffff] [bg=#000000] [font_file]
# font_file must be .ttf/.otf/.ttc: ffmpeg drawtext silently falls back to another font on .woff2 (convert with fontTools first).
set -e
SRC=$1; D=$2; ACC=${3:-#ffffff}; BG=${4:-#000000}; FONT=${5:-/System/Library/Fonts/Menlo.ttc}
mkdir -p "$D/stems_original" "$D/stems_normalized" "$D/stills_per_sound"
for f in "$SRC"/*.{wav,mp3,ogg,m4a,aac,flac,opus,webm}; do [ -f "$f" ] || continue; n=$(basename "${f%.*}"); cp "$f" "$D/stems_original/"
  # embedded tags travel with the file: keep them next to it, and flag anything that reads like a licence restriction
  ffprobe -v error -show_entries format_tags -of default=nw=1 "$f" > "$D/stems_original/$n.tags.txt"
  grep -qiE "not approved|reference only|demo|watermark|do not distribute|confidential" "$D/stems_original/$n.tags.txt" && echo "WARNING: $n tags suggest a licence restriction: $(tr '\n' ' ' < "$D/stems_original/$n.tags.txt" | cut -c1-200)" >&2
  pk=$(ffmpeg -hide_banner -i "$f" -af volumedetect -f null - 2>&1 | awk '/max_volume/{print $5}'); g=$(echo "-1 - ($pk)" | bc)
  ffmpeg -nostdin -v error -y -i "$f" -af "volume=${g}dB" -c:a pcm_s24le "$D/stems_normalized/$n.wav"
  ffmpeg -nostdin -v error -y -i "$f" -f lavfi -i "color=c=${BG}:s=1920x1080" -filter_complex "[0]aformat=channel_layouts=mono,dynaudnorm=f=200:g=15,showwavespic=s=1920x600:colors=${ACC}[w];[1][w]overlay=0:240:format=auto,drawtext=fontfile=${FONT}:text='${n}':x=64:y=64:fontsize=36:fontcolor=${ACC}" -frames:v 1 "$D/stills_per_sound/${n}_waveform.png"
  ffmpeg -nostdin -v error -y -i "$f" -lavfi "showspectrumpic=s=1920x1080:legend=0:color=green:scale=log:fscale=log" "$D/stills_per_sound/${n}_spectrogram.png"
  echo "$n  peak ${pk} dB -> +${g} dB"; done
