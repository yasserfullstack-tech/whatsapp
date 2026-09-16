#!/bin/sh
set -eu

staging_env=${1:-}
production_env=${2:-}
[ -n "$staging_env" ] && [ -n "$production_env" ] || {
  echo "Usage: verify-environment-isolation.sh <staging-env> <production-env>" >&2
  exit 1
}
[ -f "$staging_env" ] || { echo "Staging environment file not found: $staging_env" >&2; exit 1; }
[ -f "$production_env" ] || { echo "Production environment file not found: $production_env" >&2; exit 1; }

read_env() {
  file=$1
  key=$2
  awk -v key="$key" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$file"
}

require_value() {
  file=$1
  key=$2
  expected=$3
  actual=$(read_env "$file" "$key")
  [ "$actual" = "$expected" ] || {
    echo "$key must be '$expected' in $file" >&2
    exit 1
  }
}

require_different() {
  key=$1
  staging_value=$(read_env "$staging_env" "$key")
  production_value=$(read_env "$production_env" "$key")
  [ -n "$staging_value" ] || { echo "$key is missing from staging" >&2; exit 1; }
  [ -n "$production_value" ] || { echo "$key is missing from production" >&2; exit 1; }
  [ "$staging_value" != "$production_value" ] || {
    echo "$key must differ between staging and production" >&2
    exit 1
  }
  echo "isolation check passed: $key differs"
}

require_value "$staging_env" DEPLOYMENT_ENVIRONMENT staging
require_value "$production_env" DEPLOYMENT_ENVIRONMENT production
require_value "$staging_env" SENTRY_ENVIRONMENT staging
require_value "$production_env" SENTRY_ENVIRONMENT production

# Identifiers and credentials whose reuse would couple the two environments.
for key in \
  COMPOSE_PROJECT_NAME \
  APP_DOMAIN \
  APP_URL \
  POSTGRES_DB \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  BETTER_AUTH_SECRET \
  CREDENTIAL_ENCRYPTION_KEY \
  RESEND_API_KEY \
  META_APP_ID \
  META_APP_SECRET \
  META_CONFIG_ID \
  META_VERIFY_TOKEN \
  R2_ACCESS_KEY_ID \
  R2_SECRET_ACCESS_KEY \
  R2_BUCKET \
  GRAFANA_ADMIN_PASSWORD
do
  require_different "$key"
done

staging_redis=$(read_env "$staging_env" REDIS_URL)
production_redis=$(read_env "$production_env" REDIS_URL)
if [ "$staging_redis" = "$production_redis" ]; then
  echo "note: REDIS_URL text matches; this is acceptable only when separate Compose projects/hosts provide distinct Valkey instances"
fi

echo "Staging/production isolation checks passed without printing secret values"
