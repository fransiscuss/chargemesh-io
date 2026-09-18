#!/usr/bin/env bash
set -euo pipefail

# Uses only the local SteVe QA service from this repository's Compose project.
for attempt in $(seq 1 120); do
  if curl --silent --fail http://localhost:8180/steve/manager/signin >/dev/null; then
    break
  fi
  if [ "$attempt" -eq 120 ]; then
    docker compose logs steve
    exit 1
  fi
  sleep 5
done

qa_sql() {
  docker compose exec -T steve-db mysql -usteve -pchangeme --batch --skip-column-names stevedb -e "$1"
}

qa_sql "INSERT IGNORE INTO charge_box (charge_box_id) VALUES ('SIM001'); INSERT IGNORE INTO ocpp_tag (id_tag) VALUES ('TEST-TAG');"
qa_before=$(qa_sql "SELECT COUNT(*) FROM transaction_stop;")
pnpm sim --url ws://localhost:8180/steve/websocket/CentralSystemService --id SIM001 --version 1.6 --scenario full-session --id-tag TEST-TAG
qa_after=$(qa_sql "SELECT COUNT(*) FROM transaction_stop;")
test "$qa_after" -gt "$qa_before"
printf 'SteVe persisted a completed simulator transaction.\n'
