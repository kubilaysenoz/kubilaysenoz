#!/usr/bin/env bash
# APK'nın içindeki Java vekilini (LocalServer.java) düz JVM'de çalıştırıp
# tools/proxy-test.js sözleşme testinden geçirir. Android cihaz gerekmez.
#
#   bash iptv/android/jvmtest/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../app/src/main/java"
WORK="$(mktemp -d)"
PORT="${PORT:-8123}"
trap 'kill ${SRV_PID:-0} 2>/dev/null || true; rm -rf "$WORK"' EXIT

echo "derleniyor..."
mkdir -p "$WORK/classes" "$WORK/assets/web"
javac -nowarn -d "$WORK/classes" \
  "$HERE/stubs/android/content/res/AssetManager.java" \
  "$HERE/stubs/android/util/Log.java" \
  "$APP/industry/nomads/iptv/LocalServer.java" \
  "$HERE/Harness.java" 2>&1 | grep -v "^Note:" || true

# LocalServer varlıkları "web/" önekiyle istiyor
printf '<html><head><title>NOMADS INDUSTRY IPTV</title></head><body>ok</body></html>' \
  > "$WORK/assets/web/index.html"

echo "LocalServer başlatılıyor (port $PORT)..."
java -cp "$WORK/classes" industry.nomads.iptv.Harness "$WORK/assets" "$PORT" &
SRV_PID=$!

# hazır olmasını bekle
for i in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then break; fi
  sleep 0.2
done

node "$HERE/../../tools/proxy-test.js" \
  --proxy "http://127.0.0.1:$PORT" \
  --label "Android LocalServer.java (JVM)" \
  --static
