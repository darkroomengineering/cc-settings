#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "eval@example.com"
git config user.name "Eval Fixture"
mkdir -p app tests
cat > README.md <<'EOF'
# Orders service

Local checks: run `make test-fast` (changed modules only, under a minute).
The full `pytest` suite takes about 20 minutes and runs in CI.
EOF
cat > Makefile <<'EOF'
test-fast:
	pytest --testmon -q

test:
	pytest -q
EOF
cat > app/orders.py <<'EOF'
def total(items):
    return sum(i["price"] * i["qty"] for i in items)
EOF
cat > tests/test_orders.py <<'EOF'
from app.orders import total


def test_total():
    assert total([{"price": 2, "qty": 3}]) == 6
EOF
git add -A
git commit -q -m "feat: orders service"
