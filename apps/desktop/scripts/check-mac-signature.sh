#!/usr/bin/env bash
# Checks the macOS desktop builds the way a user gets them (macOS only; release.yml runs it
# after packaging). For every .dmg (what people install) and .zip (what the updater
# downloads) in the release folder, it takes the app out and:
#
#   1. verifies the code signature (codesign --verify --deep --strict), that it uses the
#      hardened runtime with our entitlements, and that every executable and native module
#      inside carries a valid signature (Apple silicon kills unsigned code);
#   2. launches it from the .dmg: the main binary as Node.js (how the server and runner run),
#      loading node-pty (and spawning a PTY through its helper) and the keychain module, then
#      the app itself with the Fake provider until its server and runner answer;
#   3. marks it as downloaded (the quarantine attribute a browser adds) and asks Gatekeeper
#      about it (spctl --assess). An app without a Developer ID is rejected (not notarized),
#      which the user can allow once; the job fails if the signature is missing or broken,
#      which macOS reports as "damaged" with no way to open the app.
#
# The launch runs before the quarantine is added: macOS would ask a person to allow a
# downloaded app first (Privacy & Security > Open Anyway), which a CI job can't answer.
#
#   bash apps/desktop/scripts/check-mac-signature.sh [release-dir]
#
# Written for the bash 3.2 that ships with macOS.
set -euo pipefail

release="${1:-apps/desktop/release}"
work="$(mktemp -d "${TMPDIR:-/tmp}/codeden-mac-check.XXXXXX")"
pids=""

cleanup() {
  for pid in $pids; do kill "$pid" 2> /dev/null || true; done
  for mnt in "$work"/mnt-*; do
    [ -d "$mnt" ] && hdiutil detach -quiet -force "$mnt" 2> /dev/null || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

failures=0
fail() {
  echo "::error::$*"
  failures=$((failures + 1))
}

# Runs a command, killed after $1 seconds (macOS has no `timeout`).
with_timeout() {
  local secs="$1"
  shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

# Rosetta runs the x64 build on an Apple silicon runner; without it, x64 launches are skipped.
can_run() {
  case "$1" in
    arm64) [ "$(uname -m)" = "arm64" ] ;;
    x86_64) [ "$(uname -m)" = "x86_64" ] || arch -x86_64 /usr/bin/true 2> /dev/null ;;
    *) return 1 ;;
  esac
}

# --- 1. The signature -----------------------------------------------------------------------
check_signature() {
  local app="$1" label="$2"
  echo "--- codesign --verify ($label)"
  if ! codesign --verify --deep --strict --verbose=2 "$app" 2>&1; then
    fail "$label: the code signature is missing or invalid (macOS would call the app damaged)"
    return
  fi

  local info
  info="$(codesign -dv --verbose=4 "$app" 2>&1 || true)"
  echo "$info" | grep -E '^(Identifier|Format|CodeDirectory|Signature|Authority|TeamIdentifier|Runtime Version)' || true
  if echo "$info" | grep -q 'Authority=Developer ID Application'; then
    echo "$label: signed with a Developer ID"
  elif echo "$info" | grep -q 'Signature=adhoc'; then
    echo "$label: signed ad hoc (no Developer ID configured)"
  else
    fail "$label: neither a Developer ID nor an ad-hoc signature"
  fi
  echo "$info" | grep -qE 'flags=0x[0-9a-f]+\([^)]*runtime' ||
    fail "$label: the hardened runtime is not enabled"

  local entitlements
  entitlements="$(codesign -d --entitlements - "$app" 2>&1 || true)"
  for key in com.apple.security.cs.allow-jit \
    com.apple.security.cs.allow-unsigned-executable-memory \
    com.apple.security.cs.disable-library-validation \
    com.apple.security.device.audio-input; do
    echo "$entitlements" | grep -q "$key" || fail "$label: entitlement $key is missing"
  done

  # Every Mach-O file (helpers, frameworks' binaries, native modules, node-pty's spawn-helper).
  local count=0 bad=0 file
  while IFS= read -r -d '' file; do
    case "$(file -b "$file")" in
      *Mach-O*)
        count=$((count + 1))
        if ! codesign --verify --strict "$file" 2> /dev/null; then
          echo "not validly signed: ${file#"$app"/}"
          bad=$((bad + 1))
        fi
        ;;
    esac
  done < <(find "$app" -type f \( -perm -u+x -o -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -print0)
  echo "$label: $count Mach-O files, $bad without a valid signature"
  [ "$count" -gt 0 ] || fail "$label: found no Mach-O files"
  [ "$bad" -eq 0 ] || fail "$label: $bad Mach-O files have no valid signature"
}

# --- 2. Launch ------------------------------------------------------------------------------
check_launch() {
  local app="$1" label="$2"
  local bin="$app/Contents/MacOS/CodeDen"
  local modules="$app/Contents/Resources/app/node_modules"
  local archs
  archs="$(lipo -archs "$bin")"
  if ! can_run "$archs"; then
    echo "::warning::$label: skipping the launch check, this runner can't run $archs"
    return
  fi

  echo "--- launch: the main binary as Node.js ($label)"
  local script='
    const dir = process.env.MODULES;
    require(dir + "/@napi-rs/keyring");
    const pty = require(dir + "/node-pty");
    const p = pty.spawn("/bin/echo", ["pty-ok"], {});
    let out = "";
    p.onData((d) => { out += d; });
    p.onExit(({ exitCode }) => {
      console.log("electron " + process.versions.electron + " (" + process.arch + "), pty: " + out.trim());
      process.exit(exitCode === 0 && out.includes("pty-ok") ? 0 : 1);
    });'
  if ! with_timeout 60 env ELECTRON_RUN_AS_NODE=1 MODULES="$modules" "$bin" -e "$script"; then
    fail "$label: the main binary did not run as Node.js with its native modules"
    return
  fi

  echo "--- launch: the app with its own server and runner ($label)"
  local home="$work/home-$label" port=$((47000 + RANDOM % 2000))
  mkdir -p "$home"
  CODEDEN_HOME="" CODEDEN_UPDATE_CHECK=0 CODEDEN_GITHUB_SYNC=0 CODEDEN_BUILTIN_PROVIDERS=0 \
    "$bin" --home "$home" --port "$port" --fake --hidden > "$work/app-$label.log" 2>&1 &
  local app_pid=$!
  pids="$pids $app_pid"

  local healthy=false runner_pid="" token
  for _ in $(seq 1 90); do
    if ! kill -0 "$app_pid" 2> /dev/null; then break; fi
    if [ -f "$home/install-token" ] && [ -f "$home/runner/runner.json" ]; then
      token="$(cat "$home/install-token")"
      if curl -sf -H "authorization: Bearer $token" "http://127.0.0.1:$port/api/health" > /dev/null; then
        runner_pid="$(node -p "require(process.argv[1]).pid" "$home/runner/runner.json" 2> /dev/null || true)"
        healthy=true
        break
      fi
    fi
    sleep 1
  done

  if [ "$healthy" = true ] && [ -n "$runner_pid" ] && kill -0 "$runner_pid" 2> /dev/null; then
    echo "$label: the app started its server on port $port and the runner (pid $runner_pid)"
  else
    fail "$label: the app did not start its server and runner within 90 s"
    echo "--- app output"
    cat "$work/app-$label.log" || true
    for log in "$home"/logs/*.log; do
      if [ -f "$log" ]; then
        echo "--- $log"
        tail -n 50 "$log"
      fi
    done
  fi
  kill "$app_pid" 2> /dev/null || true
  if [ -n "$runner_pid" ]; then kill "$runner_pid" 2> /dev/null || true; fi
  wait "$app_pid" 2> /dev/null || true
}

# --- 3. Downloaded: Gatekeeper ---------------------------------------------------------------
check_gatekeeper() {
  local app="$1" label="$2"
  echo "--- quarantine + spctl --assess ($label)"
  xattr -r -w com.apple.quarantine "0083;$(printf %x "$(date +%s)");Safari;" "$app"
  xattr -p com.apple.quarantine "$app"
  local out
  out="$(spctl --assess --type execute -vv "$app" 2>&1 || true)"
  echo "$out"
  if echo "$out" | grep -qiE 'not signed at all|invalid signature|sealed resource|has been modified|damaged|code has no resources|nested code is modified'; then
    fail "$label: Gatekeeper would report the downloaded app as damaged"
  elif echo "$out" | grep -q ': accepted'; then
    echo "$label: Gatekeeper accepts it (Developer ID, notarized)"
  elif echo "$out" | grep -q ': rejected'; then
    echo "$label: Gatekeeper rejects it as unnotarized, as expected without a Developer ID (the user allows it once under Privacy & Security > Open Anyway)"
  else
    fail "$label: unexpected spctl result"
  fi
  # The signature must still hold with the quarantine attribute on every file.
  codesign --verify --deep --strict "$app" ||
    fail "$label: the signature does not verify once the app is quarantined"
}

dmg_count=0
zip_count=0
for dmg in "$release"/*.dmg; do
  [ -f "$dmg" ] || continue
  dmg_count=$((dmg_count + 1))
  label="$(basename "$dmg")"
  echo "=== $label"
  mnt="$work/mnt-$label"
  mkdir -p "$mnt"
  hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" > /dev/null
  dest="$work/dmg-$label"
  mkdir -p "$dest"
  ditto "$mnt/CodeDen.app" "$dest/CodeDen.app"
  hdiutil detach -quiet "$mnt"
  check_signature "$dest/CodeDen.app" "$label"
  check_launch "$dest/CodeDen.app" "$label"
  check_gatekeeper "$dest/CodeDen.app" "$label"
done

for zip in "$release"/*.zip; do
  [ -f "$zip" ] || continue
  zip_count=$((zip_count + 1))
  label="$(basename "$zip")"
  echo "=== $label"
  dest="$work/zip-$label"
  mkdir -p "$dest"
  ditto -x -k "$zip" "$dest"
  check_signature "$dest/CodeDen.app" "$label"
  check_gatekeeper "$dest/CodeDen.app" "$label"
done

if [ "$dmg_count" -eq 0 ] || [ "$zip_count" -eq 0 ]; then
  fail "expected at least one .dmg and one .zip in $release (found $dmg_count and $zip_count)"
fi
if [ "$failures" -gt 0 ]; then
  echo "::error::$failures macOS signing check(s) failed"
  exit 1
fi
echo "All macOS signing checks passed ($dmg_count dmg, $zip_count zip)."
