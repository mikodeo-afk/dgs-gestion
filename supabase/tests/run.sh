#!/usr/bin/env bash
# Lance les migrations et les tests de droits sur un PostgreSQL local jetable.
# Prérequis : psql et un serveur PostgreSQL accessible (variable PGURL, sinon base locale).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="dgs_test_$$"
URL_BASE="${PGURL:-postgresql:///postgres}"
psql "$URL_BASE" -qc "create database $DB" >/dev/null
trap 'psql "$URL_BASE" -qc "drop database if exists $DB" >/dev/null' EXIT
URL="${URL_BASE%/*}/$DB"
psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/stub_auth.sql >/dev/null
for f in migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
for t in tests/tests.sql tests/tests_finances.sql tests/tests_rh.sql tests/tests_postes.sql tests/tests_tva.sql tests/tests_achats.sql tests/tests_rt.sql tests/tests_proformas_pv.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$t" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //' | grep -v '^\s*$'
done
