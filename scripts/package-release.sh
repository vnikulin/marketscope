#!/usr/bin/env bash
set -Eeuo pipefail

repository=${1:?GitHub repository is required}
version=${2:?Release version is required}
output_directory=${3:?Output directory is required}

[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || {
  printf 'Invalid GitHub repository: %s\n' "$repository" >&2
  exit 1
}
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || {
  printf 'Release tag must use semantic versioning, for example v1.0.0.\n' >&2
  exit 1
}

repository_lower=$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]')
image="ghcr.io/$repository_lower"
release_url="https://github.com/$repository/releases/download/$version"
stage=$(mktemp --directory)
trap 'rm -rf -- "$stage"' EXIT

mkdir --parents "$output_directory" "$stage/bundle"
install --mode=0644 docker-compose.yml "$stage/bundle/docker-compose.yml"
install --mode=0755 scripts/marketscope "$stage/bundle/marketscope"
tar --create --gzip --file "$output_directory/marketscope-linux.tar.gz" \
  --directory "$stage/bundle" docker-compose.yml marketscope
(
  cd "$output_directory"
  sha256sum marketscope-linux.tar.gz >marketscope-linux.tar.gz.sha256
)

sed \
  -e "s|__MARKETSCOPE_IMAGE__|$image|g" \
  -e "s|__MARKETSCOPE_IMAGE_TAG__|$version|g" \
  -e "s|__MARKETSCOPE_RELEASE_URL__|$release_url|g" \
  -e "s|__MARKETSCOPE_VERSION__|$version|g" \
  install.sh >"$output_directory/install.sh"
chmod 0755 "$output_directory/install.sh"
