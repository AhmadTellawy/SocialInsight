#!/usr/bin/env bash
# Disposable GitHub CI peer only. No hosted database or real credential input.
# Usage: bash ops/release18-transport/linux-test-setup.sh start|stop
# Node test container: mount "$RELEASE18_TEST_FIXTURE/tls:/tls:ro", network host.
set -euo pipefail
umask 077

[[ "$(uname -s)" == Linux && "${GITHUB_ACTIONS:-}" == true ]] || { echo 'GITHUB_LINUX_FIXTURE_REQUIRED' >&2; exit 1; }
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] || { echo 'CI_RUN_ID_REQUIRED' >&2; exit 1; }
[[ $# == 1 && ( "$1" == start || "$1" == stop ) ]] || { echo 'FIXTURE_ACTION_INVALID' >&2; exit 1; }
base="$(realpath -e -- "${RUNNER_TEMP:?RUNNER_TEMP required}")"
[[ -d "$base" && ! -L "$RUNNER_TEMP" ]] || { echo 'FIXTURE_BASE_INVALID' >&2; exit 1; }
identity="si-r18-transport-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
fixture="$base/$identity"
container="$identity"
image='postgres:17.9-bookworm'
owner_label='socialinsight.synthetic.transport'

verify_owned_directory() {
  [[ -d "$fixture" && ! -L "$fixture" && "$(realpath -e -- "$fixture")" == "$base/$identity" ]]
  [[ -f "$fixture/.owner" && ! -L "$fixture/.owner" && "$(cat -- "$fixture/.owner")" == "$identity" ]]
}

cleanup() {
  # Never delete a same-name container unless this exact CI fixture owns its label.
  if docker container inspect "$container" >/dev/null 2>&1; then
    [[ "$(docker inspect --format '{{index .Config.Labels "socialinsight.synthetic.transport"}}' "$container")" == "$identity" ]] || { echo 'CONTAINER_OWNERSHIP_MISMATCH' >&2; return 1; }
    docker rm -fv "$container" >/dev/null
    if docker container inspect "$container" >/dev/null 2>&1; then echo 'CONTAINER_CLEANUP_FAILED' >&2; return 1; fi
  fi
  if [[ -e "$fixture" || -L "$fixture" ]]; then
    verify_owned_directory || { echo 'FIXTURE_OWNERSHIP_MISMATCH' >&2; return 1; }
    # Resolved absolute root is checked above; only this exact synthetic root is removed.
    rm -rf -- "$fixture"
    [[ ! -e "$fixture" && ! -L "$fixture" ]] || return 1
  fi
  echo 'SYNTHETIC_TLS_FIXTURE_CLEANUP_PASSED'
}

if [[ "$1" == stop ]]; then cleanup; exit; fi
[[ ! -e "$fixture" && ! -L "$fixture" ]] || { echo 'FIXTURE_ALREADY_EXISTS' >&2; exit 1; }
if docker container inspect "$container" >/dev/null 2>&1; then echo 'CONTAINER_ALREADY_EXISTS' >&2; exit 1; fi
mkdir -m 700 -- "$fixture"
printf '%s\n' "$identity" > "$fixture/.owner"
on_failed_start() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then cleanup || echo 'FIXTURE_CLEANUP_REQUIRES_REVIEW' >&2; fi
  exit "$status"
}
trap on_failed_start EXIT
mkdir -m 755 -- "$fixture/tls"

# Fixture keys are ephemeral and never printed or uploaded. CA trust is local to this test.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 -subj '/CN=SocialInsight synthetic transport CA' -keyout "$fixture/tls/ca.key" -out "$fixture/tls/ca.pem" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout "$fixture/tls/server.key" -out "$fixture/tls/server.csr" >/dev/null 2>&1
printf '%s\n' 'subjectAltName=DNS:localhost,IP:127.0.0.1' 'extendedKeyUsage=serverAuth' > "$fixture/tls/server.ext"
openssl x509 -req -in "$fixture/tls/server.csr" -CA "$fixture/tls/ca.pem" -CAkey "$fixture/tls/ca.key" -CAcreateserial -days 1 -sha256 -extfile "$fixture/tls/server.ext" -out "$fixture/tls/server.crt" >/dev/null 2>&1
chmod 644 "$fixture/tls/ca.pem" "$fixture/tls/server.crt"
cat > "$fixture/tls/pg_hba.conf" <<'HBA'
local all all trust
hostssl all all 127.0.0.1/32 scram-sha-256
hostssl all all ::1/128 scram-sha-256
hostnossl all all 0.0.0.0/0 reject
hostnossl all all ::0/0 reject
HBA
chmod 644 "$fixture/tls/pg_hba.conf"
docker pull "$image" >/dev/null
docker run --rm --network none -v "$fixture/tls:/tls" --entrypoint sh "$image" -c 'chown postgres:postgres /tls/server.key; chmod 600 /tls/server.key'
docker run -d --name "$container" --label "$owner_label=$identity" --network host \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=256m \
  -e POSTGRES_PASSWORD=settings-local-fixture -v "$fixture/tls:/tls:ro" "$image" \
  -p 55447 -c listen_addresses=127.0.0.1 -c ssl=on \
  -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key \
  -c hba_file=/tls/pg_hba.conf >/dev/null
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container" pg_isready -q -U postgres -d postgres -h 127.0.0.1 -p 55447; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'SYNTHETIC_DATABASE_NOT_READY' >&2; exit 1; }
# Readiness alone is not proof of the template, authentication, or strict TLS.
verify_owned_directory
[[ -n "${GITHUB_ENV:-}" ]] || { echo 'GITHUB_ENV_REQUIRED' >&2; exit 1; }
printf 'RELEASE18_TEST_FIXTURE=%s\nRELEASE18_TEST_CONTAINER=%s\n' "$fixture" "$container" >> "$GITHUB_ENV"
echo 'SYNTHETIC_TLS_FIXTURE_READY'
