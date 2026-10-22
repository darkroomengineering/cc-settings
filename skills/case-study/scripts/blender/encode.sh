#!/bin/zsh
# encode.sh <mode> <png_pattern> <out> [WxH]
#   mode = dark   : composite RGBA PNGs over #0b0f0a -> H.264 mp4 (BT.709, tagged)
#          opaque : opaque PNGs -> H.264 mp4 (BT.709, tagged)
#          prores : RGBA PNGs -> ProRes 4444 + alpha .mov
set -e
F=${FFMPEG:-ffmpeg}
mode=$1; pat=$2; out=$3; size=${4:-1920x1080}
TAGS=(-color_primaries bt709 -color_trc bt709 -colorspace bt709)
X264=(-c:v libx264 -crf 16 -preset slow -tune film -movflags +faststart)
case $mode in
  dark)
    $F -y -loglevel error -f lavfi -i "color=c=0x0b0f0a:s=${size}:r=24,format=rgb24" -framerate 24 -start_number 0 -i "$pat" \
      -filter_complex "[0][1]overlay=format=rgb:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
      $TAGS $X264 "$out" ;;
  opaque)
    $F -y -loglevel error -framerate 24 -start_number 0 -i "$pat" \
      -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" $TAGS $X264 "$out" ;;
  prores)
    $F -y -loglevel error -framerate 24 -start_number 0 -i "$pat" \
      -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le" \
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0 $TAGS "$out" ;;
esac
${FFPROBE:-ffprobe} -v error -show_entries stream=codec_name,width,height,pix_fmt,nb_frames:format=duration,size -of compact "$out"
