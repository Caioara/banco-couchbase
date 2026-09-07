#!/bin/sh
set -e

COUCHBASE_URL="${COUCHBASE_URL:-http://couchbase:8091}"
COUCHBASE_USERNAME="${COUCHBASE_USERNAME:-Administrator}"
COUCHBASE_PASSWORD="${COUCHBASE_PASSWORD:-password}"
COUCHBASE_BUCKET="${COUCHBASE_BUCKET:-agendamentos}"
COUCHBASE_SCOPE="${COUCHBASE_SCOPE:-_default}"
COUCHBASE_COLLECTION_USERS="${COUCHBASE_COLLECTION_USERS:-users}"
COUCHBASE_COLLECTION_EVENTS="${COUCHBASE_COLLECTION_EVENTS:-events}"
COUCHBASE_COLLECTION_ENROLLMENTS="${COUCHBASE_COLLECTION_ENROLLMENTS:-enrollments}"
COUCHBASE_COLLECTION_SESSIONS="${COUCHBASE_COLLECTION_SESSIONS:-sessions}"

request_code() {
  method="$1"
  url="$2"
  data="$3"
  auth_flag="$4"

  curl -s -o /dev/null -w "%{http_code}" -X "$method" $auth_flag -d "$data" "$url"
}

wait_for_couchbase() {
  echo "Aguardando Couchbase em ${COUCHBASE_URL}..."
  until curl -s "${COUCHBASE_URL}/pools" >/dev/null; do
    sleep 2
  done
}

wait_for_query() {
  echo "Aguardando servico de query em ${COUCHBASE_URL%:8091}:8093..."
  until curl -s "${COUCHBASE_URL%:8091}:8093/admin/ping" >/dev/null; do
    sleep 2
  done
}

ensure_status() {
  code="$(printf '%s' "$1" | tr -d '\r')"
  description="$2"
  expected="$(printf '%s' "$3" | tr -d '\r')"
  alternate="$(printf '%s' "${4:-}" | tr -d '\r')"
  alternate_two="$(printf '%s' "${5:-}" | tr -d '\r')"

  if [ "$code" != "$expected" ] \
    && { [ -z "$alternate" ] || [ "$code" != "$alternate" ]; } \
    && { [ -z "$alternate_two" ] || [ "$code" != "$alternate_two" ]; }; then
    echo "Falha em ${description}. HTTP ${code}."
    exit 1
  fi
}

wait_for_couchbase

# Seleciona servicos antes da inicializacao do cluster.
services_code="$(request_code POST "${COUCHBASE_URL}/node/controller/setupServices" "services=kv,n1ql,index" "")"
ensure_status "$services_code" "configuracao de servicos do cluster" "200" "400" "401"
if [ "$services_code" = "401" ]; then
  echo "Servicos do cluster ja configurados."
fi

# Define credenciais admin.
web_code="$(request_code POST "${COUCHBASE_URL}/settings/web" "username=${COUCHBASE_USERNAME}&password=${COUCHBASE_PASSWORD}&port=8091" "")"
ensure_status "$web_code" "definicao de credenciais do cluster" "200" "400" "401"
if [ "$web_code" = "401" ]; then
  echo "Credenciais do cluster ja definidas."
fi

# Define quotas basicas.
quota_code="$(request_code POST "${COUCHBASE_URL}/pools/default" "memoryQuota=512&indexMemoryQuota=256" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$quota_code" "configuracao de quotas do cluster" "200"

# Define modo de armazenamento do indexador antes da criacao de indices.
index_storage_code="$(request_code POST "${COUCHBASE_URL}/settings/indexes" "storageMode=plasma" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$index_storage_code" "configuracao do storage mode do indexador" "200"

# Cria bucket.
bucket_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets" "name=${COUCHBASE_BUCKET}&ramQuotaMB=256&bucketType=couchbase&flushEnabled=1" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$bucket_code" "criacao do bucket" "202" "400"

wait_for_query

# Cria scope e collections.
scope_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets/${COUCHBASE_BUCKET}/scopes" "name=${COUCHBASE_SCOPE}" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$scope_code" "criacao do scope" "200" "400"

users_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets/${COUCHBASE_BUCKET}/scopes/${COUCHBASE_SCOPE}/collections" "name=${COUCHBASE_COLLECTION_USERS}" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$users_code" "criacao da collection users" "200" "400"

events_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets/${COUCHBASE_BUCKET}/scopes/${COUCHBASE_SCOPE}/collections" "name=${COUCHBASE_COLLECTION_EVENTS}" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$events_code" "criacao da collection events" "200" "400"

enrollments_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets/${COUCHBASE_BUCKET}/scopes/${COUCHBASE_SCOPE}/collections" "name=${COUCHBASE_COLLECTION_ENROLLMENTS}" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$enrollments_code" "criacao da collection enrollments" "200" "400"

sessions_code="$(request_code POST "${COUCHBASE_URL}/pools/default/buckets/${COUCHBASE_BUCKET}/scopes/${COUCHBASE_SCOPE}/collections" "name=${COUCHBASE_COLLECTION_SESSIONS}" "-u ${COUCHBASE_USERNAME}:${COUCHBASE_PASSWORD}")"
ensure_status "$sessions_code" "criacao da collection sessions" "200" "400"

echo "Couchbase inicializado."
