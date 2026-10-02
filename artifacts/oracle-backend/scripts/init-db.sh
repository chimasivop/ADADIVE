#!/usr/bin/env bash
# Create the databases the oracle backend needs.
#
#   backend/scripts/init-db.sh
#
# The service does not create its own *database* (only its own tables, via
# `npm run migrate`), so the database has to exist before the first start. This
# script creates:
#
#   adadive_oracle       the development/production database
#   adadive_oracle_test  the database the test suite truncates between tests
#
# It is idempotent: an existing database is left alone. It does not start a
# Postgres server — point it at one you already have, e.g.
#
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres backend/scripts/init-db.sh
#
# In production the database is provisioned by the platform (RDS, Cloud SQL, a
# Kubernetes operator), and this script is not used at all.
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"

DEV_DB="${DEV_DB:-adadive_oracle}"
TEST_DB="${TEST_DB:-adadive_oracle_test}"

psql_admin() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres "$@"
}

create_if_absent() {
  local db="$1"
  local exists
  exists="$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'")"
  if [ "$exists" = "1" ]; then
    echo "database $db already exists"
    return
  fi
  # Identifiers cannot be parameterised, and these names come from this script
  # rather than from input, so quoting is enough.
  psql_admin -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\""
  echo "created database $db"
}

echo "Using postgres at $PGHOST:$PGPORT as $PGUSER"
create_if_absent "$DEV_DB"
create_if_absent "$TEST_DB"

echo
echo "Now apply the schema:"
echo "  DATABASE_URL=postgres://$PGUSER@$PGHOST:$PGPORT/$DEV_DB npm --prefix backend run migrate"
