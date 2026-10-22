#!/bin/bash
# Download the latest OM/Olympus body firmware via the vendor's updater API.
# Usage: omfw_download.sh <CAMERA_CODE e.g. E143> <outdir>
set -e
CODE=$1; OUT=${2:-.}
mkdir -p "$OUT"
REPLY=$(curl -s --user-agent "Olympus" --header "Content-Type: text/xml; Charset=UTF-8" --data @- https://fw01.om-digitalsolutions.net/ww_inform/fcache.do <<EOF
<?xml version="1.0"?>
<firmware_demand><revision>0001</revision><mac_address>00-00-00-00-80-D6</mac_address>
<time>$(date +%Y%m%d%H%M%S)</time><language>ENU</language><application>FWUT</application>
<type>0000</type><version>00005000</version><os>WIN</os><country_code>0001</country_code>
<hardwares><firmup_mode>0</firmup_mode><hardware_info>
<hard_code>OLY${CODE}000000000</hard_code><firmware_version>00001000</firmware_version>
<serial_no>V5PF30000</serial_no><default_languages><code>ENU</code></default_languages>
</hardware_info></hardwares></firmware_demand>
EOF
)
echo "$REPLY" > "$OUT/${CODE}_reply.xml"
URL=$(echo "$REPLY" | grep -oP '(?<=<url>)[^<]+' | head -1 | sed 's/&amp;/\&/g')
FN=$(echo "$REPLY" | grep -oP '(?<=<file_name>)[^<]+' | head -1)
[ -n "$URL" ] || { echo "no fw for $CODE"; echo "$REPLY"; exit 1; }
curl -s -o "$OUT/$FN" "$URL"
ls -l "$OUT/$FN"
