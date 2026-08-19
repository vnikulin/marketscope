#!/usr/bin/env bash
set -Eeuo pipefail

readonly INSTALL_DIR=/opt/marketscope
readonly DATA_DIR=/var/lib/marketscope
readonly LOG_DIR=/var/log/marketscope
readonly BACKUP_DIR=/var/backups/marketscope
readonly CLI_PATH=/usr/local/bin/marketscope
readonly DEFAULT_IMAGE='__MARKETSCOPE_IMAGE__'
readonly DEFAULT_RELEASE_URL='__MARKETSCOPE_RELEASE_URL__'
readonly DEFAULT_EXTENSION_VERSION='__MARKETSCOPE_VERSION__'

TEMP_DIR=''
PREVIOUS_DIR=''
EXISTING_INSTALL=false
FILES_APPLIED=false

fail() {
  printf 'MarketScope installer: %s\n' "$*" >&2
  return 1
}

prompt() {
  local message=$1 default=${2:-} answer
  printf '%s' "$message" >/dev/tty
  IFS= read -r answer </dev/tty
  printf '%s' "${answer:-$default}"
}

compose() {
  docker compose --env-file "$INSTALL_DIR/.env" \
    --file "$INSTALL_DIR/docker-compose.yml" "$@"
}

wait_for_health() {
  local port=3000
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    port=$(awk -F= '$1 == "MARKETSCOPE_PORT" { print $2 }' "$INSTALL_DIR/.env")
    port=${port:-3000}
  fi
  for _ in {1..30}; do
    if curl --fail --silent "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local status=$?
  trap - ERR
  [[ $status -ne 0 ]] || return 0
  printf 'Installation failed. Restoring the previous application files.\n' >&2
  if [[ "$FILES_APPLIED" == true ]]; then
    if [[ "$EXISTING_INSTALL" == true && -n "$PREVIOUS_DIR" ]]; then
      [[ ! -f "$PREVIOUS_DIR/docker-compose.yml" ]] || install --mode=0644 "$PREVIOUS_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
      [[ ! -f "$PREVIOUS_DIR/.env" ]] || install --mode=0600 "$PREVIOUS_DIR/.env" "$INSTALL_DIR/.env"
      [[ ! -f "$PREVIOUS_DIR/marketscope" ]] || install --mode=0755 "$PREVIOUS_DIR/marketscope" "$CLI_PATH"
      compose up --detach server >/dev/null 2>&1 || true
    else
      compose down --remove-orphans >/dev/null 2>&1 || true
      rm -f -- "$INSTALL_DIR/docker-compose.yml" "$INSTALL_DIR/.env" "$CLI_PATH"
    fi
  fi
  printf 'Persistent data in %s was not removed.\n' "$DATA_DIR" >&2
  exit "$status"
}

cleanup() {
  [[ -z "$TEMP_DIR" ]] || rm -rf -- "$TEMP_DIR"
}

trap rollback ERR
trap cleanup EXIT

preflight() {
  [[ ${EUID:-$(id -u)} -eq 0 ]] || fail 'run with sudo or as root'
  [[ -r /etc/os-release ]] || fail 'cannot read /etc/os-release'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ ${ID:-} == ubuntu ]] || fail 'only Ubuntu is supported'
  [[ ${VERSION_ID:-} == 22.04 || ${VERSION_ID:-} == 24.04 ]] || fail 'only Ubuntu 22.04 and 24.04 are supported'
  local architecture memory_kib free_kib
  architecture=$(dpkg --print-architecture)
  [[ "$architecture" == amd64 || "$architecture" == arm64 ]] || fail "unsupported architecture: $architecture"
  memory_kib=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
  [[ ${memory_kib:-0} -ge 2097152 ]] || fail 'at least 2 GB of RAM is required'
  free_kib=$(df --output=avail / | tail -n 1 | tr -d ' ')
  [[ ${free_kib:-0} -ge 10485760 ]] || fail 'at least 10 GB of free disk space is required'
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --head https://download.docker.com/ >/dev/null || fail 'cannot reach download.docker.com'
    curl --fail --silent --show-error --head https://github.com/ >/dev/null || fail 'cannot reach github.com'
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --spider https://download.docker.com/ || fail 'cannot reach download.docker.com'
    wget --quiet --spider https://github.com/ || fail 'cannot reach github.com'
  else
    fail 'curl or wget is required to bootstrap the installer'
  fi
}

existing_install_action() {
  [[ -f "$INSTALL_DIR/docker-compose.yml" && -f "$INSTALL_DIR/.env" ]] || return 0
  EXISTING_INSTALL=true
  local action
  action=$(prompt 'Existing MarketScope install found. Choose upgrade, repair, reconfigure, or cancel [cancel]: ' cancel)
  case "${action,,}" in
    upgrade)
      [[ -x "$CLI_PATH" ]] || fail 'installed CLI is missing; rerun and choose repair'
      "$CLI_PATH" update
      exit 0
      ;;
    repair) ;;
    reconfigure) RECONFIGURE=true ;;
    cancel) exit 0 ;;
    *) fail "unknown action: $action" ;;
  esac
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes --no-install-recommends ca-certificates curl gnupg jq tar
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    systemctl enable --now docker
    return
  fi
  local docker_key=/etc/apt/keyrings/docker.asc architecture codename
  architecture=$(dpkg --print-architecture)
  # shellcheck disable=SC1091
  . /etc/os-release
  codename=${UBUNTU_CODENAME:-$VERSION_CODENAME}
  apt-get remove --yes docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2>/dev/null || true
  install --directory --mode=0755 /etc/apt/keyrings
  curl --fail --silent --show-error https://download.docker.com/linux/ubuntu/gpg --output "$docker_key"
  gpg --batch --show-keys "$docker_key" >/dev/null
  chmod a+r "$docker_key"
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $architecture
Signed-By: $docker_key
EOF
  apt-get update
  apt-get install --yes docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  docker compose version >/dev/null
}

download_bundle() {
  local release_url=${MARKETSCOPE_RELEASE_URL:-$DEFAULT_RELEASE_URL}
  local bundle_path=${MARKETSCOPE_BUNDLE_PATH:-}
  mkdir --parents "$TEMP_DIR/bundle"
  if [[ -n "$bundle_path" ]]; then
    [[ -f "$bundle_path" ]] || fail "bundle not found: $bundle_path"
    cp -- "$bundle_path" "$TEMP_DIR/marketscope-linux.tar.gz"
    if [[ -f "$bundle_path.sha256" ]]; then
      cp -- "$bundle_path.sha256" "$TEMP_DIR/marketscope-linux.tar.gz.sha256"
    else
      sha256sum "$TEMP_DIR/marketscope-linux.tar.gz" >"$TEMP_DIR/marketscope-linux.tar.gz.sha256"
    fi
  else
    [[ "$release_url" != *'__MARKETSCOPE_'* ]] || fail 'use the rendered install.sh from a GitHub release'
    curl --fail --location --silent --show-error "$release_url/marketscope-linux.tar.gz" --output "$TEMP_DIR/marketscope-linux.tar.gz"
    curl --fail --location --silent --show-error "$release_url/marketscope-linux.tar.gz.sha256" --output "$TEMP_DIR/marketscope-linux.tar.gz.sha256"
  fi
  (
    cd "$TEMP_DIR"
    sha256sum --check marketscope-linux.tar.gz.sha256
  )
  tar --extract --gzip --file "$TEMP_DIR/marketscope-linux.tar.gz" --directory "$TEMP_DIR/bundle"
  [[ -f "$TEMP_DIR/bundle/docker-compose.yml" ]] || fail 'release bundle has no docker-compose.yml'
  [[ -f "$TEMP_DIR/bundle/marketscope" ]] || fail 'release bundle has no CLI'
}

preserve_previous_files() {
  PREVIOUS_DIR="$TEMP_DIR/previous"
  mkdir --parents "$PREVIOUS_DIR"
  [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]] || cp -- "$INSTALL_DIR/docker-compose.yml" "$PREVIOUS_DIR/docker-compose.yml"
  [[ ! -f "$INSTALL_DIR/.env" ]] || cp -- "$INSTALL_DIR/.env" "$PREVIOUS_DIR/.env"
  [[ ! -f "$CLI_PATH" ]] || cp -- "$CLI_PATH" "$PREVIOUS_DIR/marketscope"
}

write_environment() {
  local image=${MARKETSCOPE_IMAGE:-$DEFAULT_IMAGE}
  local release_url=${MARKETSCOPE_RELEASE_URL:-$DEFAULT_RELEASE_URL}
  local extension_version=${MARKETSCOPE_EXTENSION_VERSION:-$DEFAULT_EXTENSION_VERSION}
  [[ "$image" != *'__MARKETSCOPE_'* ]] || fail 'release image was not rendered into install.sh'
  [[ "$release_url" != *'__MARKETSCOPE_'* ]] || fail 'release URL was not rendered into install.sh'
  if [[ "$EXISTING_INSTALL" == true && ${RECONFIGURE:-false} != true ]]; then
    return
  fi
  local bind_address=127.0.0.1 port=3000
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    bind_address=$(awk -F= '$1 == "MARKETSCOPE_BIND_ADDRESS" { print $2 }' "$INSTALL_DIR/.env")
    port=$(awk -F= '$1 == "MARKETSCOPE_PORT" { print $2 }' "$INSTALL_DIR/.env")
  fi
  bind_address=$(prompt "Bind address [$bind_address]: " "$bind_address")
  port=$(prompt "Local port [$port]: " "$port")
  [[ "$port" =~ ^[0-9]+$ && $port -ge 1 && $port -le 65535 ]] || fail 'port must be between 1 and 65535'
  cat >"$INSTALL_DIR/.env" <<EOF
MARKETSCOPE_IMAGE=$image
MARKETSCOPE_TAG=latest
MARKETSCOPE_BIND_ADDRESS=$bind_address
MARKETSCOPE_PORT=$port
MARKETSCOPE_EXTENSION_VERSION=$extension_version
MARKETSCOPE_RELEASE_URL=$release_url
EOF
  chmod 0600 "$INSTALL_DIR/.env"
}

install_application() {
  install --directory --mode=0750 "$INSTALL_DIR" "$LOG_DIR"
  install --directory --owner=1000 --group=1000 --mode=0700 "$DATA_DIR" "$DATA_DIR/thumbnails" "$BACKUP_DIR"
  if [[ ! -f "$DATA_DIR/session.key" ]]; then
    umask 0177
    head --bytes=48 /dev/urandom | base64 >"$DATA_DIR/session.key"
    chown 1000:1000 "$DATA_DIR/session.key"
    chmod 0600 "$DATA_DIR/session.key"
  fi
  preserve_previous_files
  FILES_APPLIED=true
  install --mode=0644 "$TEMP_DIR/bundle/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
  install --mode=0755 "$TEMP_DIR/bundle/marketscope" "$CLI_PATH"
  write_environment
  if [[ "$EXISTING_INSTALL" == false ]]; then
    compose pull server
  fi
  compose up --detach server
  wait_for_health || {
    compose logs --tail 100 server >&2 || true
    fail 'server did not become healthy'
  }
}

configure_tailscale() {
  local answer dns_name port
  answer=$(prompt 'Install or configure Tailscale HTTPS now? [Y/n]: ' y)
  if [[ ${answer,,} == y || ${answer,,} == yes ]]; then
    if ! command -v tailscale >/dev/null 2>&1; then
      curl --fail --silent --show-error https://tailscale.com/install.sh --output "$TEMP_DIR/tailscale-install.sh"
      bash "$TEMP_DIR/tailscale-install.sh"
    fi
    if ! tailscale status >/dev/null 2>&1; then
      tailscale up
    fi
    port=$(awk -F= '$1 == "MARKETSCOPE_PORT" { print $2 }' "$INSTALL_DIR/.env")
    port=${port:-3000}
    tailscale serve --bg "http://127.0.0.1:$port"
    dns_name=$(tailscale status --json | jq --raw-output '.Self.DNSName // empty' | sed 's/\.$//')
    [[ -z "$dns_name" ]] || printf 'MarketScope URL: https://%s\n' "$dns_name"
    return
  fi
  printf 'MarketScope is listening only on 127.0.0.1. Run sudo marketscope repair after configuring access.\n'
  printf 'For degraded LAN HTTP, rerun this installer and choose reconfigure with bind address 0.0.0.0.\n'
  printf 'If UFW is active, add only the required LAN-subnet rule. Do not disable UFW.\n'
}

main() {
  TEMP_DIR=$(mktemp --directory /tmp/marketscope-install.XXXXXX)
  preflight
  existing_install_action
  install_base_packages
  install_docker
  download_bundle
  install_application
  configure_tailscale
  printf 'MarketScope installation completed. Run sudo marketscope status to check it.\n'
}

main "$@"
