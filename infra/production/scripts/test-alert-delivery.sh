#!/bin/sh
set -eu

ALERTMANAGER_URL=${ALERTMANAGER_URL:-http://127.0.0.1:${ALERTMANAGER_PORT:-9093}}
RUNBOOK_URL=${RUNBOOK_URL:-https://github.com/yasserfullstack-tech/whatsapp/blob/main/docs/production-alerting.md#test-alert-delivery}
TEST_ID="pr011-$(date -u +%Y%m%dT%H%M%SZ)"
STARTS_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ENDS_AT=$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

payload=$(cat <<EOF
[
  {
    "labels": {
      "alertname": "WhatsAppPr011DeliveryTest",
      "severity": "critical",
      "service": "alerting",
      "test_id": "${TEST_ID}"
    },
    "annotations": {
      "summary": "PR-011 production alert delivery test",
      "description": "Synthetic alert used to prove Alertmanager delivery to the configured human-operated destination.",
      "runbook_url": "${RUNBOOK_URL}"
    },
    "startsAt": "${STARTS_AT}",
    "endsAt": "${ENDS_AT}",
    "generatorURL": "${ALERTMANAGER_URL}"
  }
]
EOF
)

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -X POST \
  --data "$payload" \
  "$ALERTMANAGER_URL/api/v2/alerts"

echo "Triggered Alertmanager test alert: $TEST_ID"
echo "Verify the matching notification in the configured human-operated destination and retain a redacted screenshot/event ID as PR-011 evidence."
