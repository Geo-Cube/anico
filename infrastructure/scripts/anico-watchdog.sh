#!/usr/bin/env bash
# Dead-man switch pro dev VPS: kontroluje zdraví kontejnerů, disk a paměť
# a výsledek hlásí na Healthchecks.io. Spouští ho anico-watchdog.timer.
# Do hlášení jdou jen názvy kontejnerů, stavy a procenta, nikdy tajné hodnoty.
set -euo pipefail

readonly DISK_LIMIT_PERCENT=85
readonly MEMORY_MIN_KIB=$((200 * 1024))
CORE_CONTAINERS=(coolify coolify-db coolify-proxy)
# Přepis cesty slouží jen testům s fixture daty.
readonly MEMINFO=${ANICO_WATCHDOG_MEMINFO:-/proc/meminfo}
readonly INSPECT_FORMAT='{{.Name}}{{"\t"}}{{.State.Status}}{{"\t"}}{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'

# Vstup: řádky "název<TAB>stav<TAB>health<TAB>povinný(0|1)".
# Běžící kontejner s healthcheckem musí být healthy (starting je omezený
# start_period a retries, pak Docker sám přejde na unhealthy). Zastavený
# dev nebo monitoring kontejner je záměr operátora; jádro Coolify ale běžet musí.
container_failures() {
  local name state health required
  while IFS=$'\t' read -r name state health required; do
    [[ -n "$name" ]] || continue
    name=${name#/}
    if [[ "$state" == running ]]; then
      case "$health" in
        healthy | none | starting) ;;
        *) printf '%s %s\n' "$name" "$health" ;;
      esac
    elif [[ "$required" == 1 || "$state" == restarting || "$state" == dead ]]; then
      printf '%s %s\n' "$name" "$state"
    fi
  done
}

# Vstup: obsazenost kořenového FS v procentech.
disk_failure() {
  if [[ ! "$1" =~ ^[0-9]+$ ]]; then
    echo 'disk usage unknown'
  elif (($1 >= DISK_LIMIT_PERCENT)); then
    printf 'disk / %s%% used (limit %s%%)\n' "$1" "$DISK_LIMIT_PERCENT"
  fi
}

# Vstup: MemAvailable v KiB.
memory_failure() {
  if [[ ! "$1" =~ ^[0-9]+$ ]]; then
    echo 'memory availability unknown'
  elif (($1 <= MEMORY_MIN_KIB)); then
    printf 'memory available %s MiB (minimum %s MiB)\n' "$(($1 / 1024))" "$((MEMORY_MIN_KIB / 1024))"
  fi
}

collect_containers() {
  local name ids
  docker version --format '{{.Server.Version}}' >/dev/null || return 1
  for name in "${CORE_CONTAINERS[@]}"; do
    if ! docker inspect --format "$INSPECT_FORMAT{{\"\t\"}}1" "$name" 2>/dev/null; then
      printf '%s\tmissing\tnone\t1\n' "$name"
    fi
  done
  # Filtry `label` v jednom `docker ps` platí současně, proto dva dotazy.
  ids=$(
    docker ps --all --quiet --no-trunc --filter label=com.anico.environment=dev
    docker ps --all --quiet --no-trunc --filter label=com.anico.role=monitoring
  ) || return 1
  ids=$(sort -u <<<"$ids")
  if [[ -n "$ids" ]]; then
    # Kontejner smazaný mezi `ps` a `inspect` není chyba; ID neobsahují mezery.
    # shellcheck disable=SC2086
    docker inspect --format "$INSPECT_FORMAT{{\"\t\"}}0" $ids 2>/dev/null || true
  fi
}

report() {
  curl --fail --silent --show-error --max-time 10 --retry 3 --output /dev/null "$@"
}

main() {
  local url=${ANICO_WATCHDOG_PING_URL:-}
  if [[ ! "$url" =~ ^https://hc-ping\.com/[A-Za-z0-9_-]+(/[a-z0-9_-]+)?$ ]]; then
    echo 'ANICO_WATCHDOG_PING_URL is missing or invalid' >&2
    return 1
  fi
  local containers percent available failures=''
  # Docker nedostupný je selhání sám o sobě; ping proto odejde i tak.
  if containers=$(collect_containers); then
    failures+=$(container_failures <<<"$containers")$'\n'
  else
    failures+=$'docker unavailable\n'
  fi
  # Chyba měření se nahlásí jako "unknown", nesmí ukončit skript bez pingu.
  percent=$(df --output=pcent / | awk 'NR == 2 { gsub(/[^0-9]/, ""); print }') || percent=''
  available=$(awk '/^MemAvailable:/ { print $2 }' "$MEMINFO") || available=''
  failures+=$(disk_failure "$percent")$'\n'
  failures+=$(memory_failure "$available")
  failures=$(printf '%s\n' "$failures" | awk 'NF')
  if [[ -n "$failures" ]]; then
    printf '%s\n' "$failures"
    report --data-binary "$failures" "$url/fail"
    return 1
  fi
  report "$url"
  echo 'All checks passed'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
