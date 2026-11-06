#!/usr/bin/env bash
# Atualiza o bot sozinho quando há commit novo no GitHub.
# Roda no servidor por cron. Não mexe em .env nem em auth.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="${COMPOSE:-docker compose}"
BRANCH="${BRANCH:-main}"
cd "$DIR" || exit 1

# Evita duas atualizações ao mesmo tempo.
exec 9>"$DIR/deploy/.lock"
flock -n 9 || exit 0

git fetch --quiet origin "$BRANCH" || { echo "$(date '+%F %T') fetch falhou"; exit 1; }
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date '+%F %T') atualizando ${LOCAL:0:7} -> ${REMOTE:0:7}"
git reset --hard "origin/$BRANCH" --quiet || exit 1

# Se o build falhar, o container antigo continua rodando.
if $COMPOSE up -d --build; then
  echo "$(date '+%F %T') ok, bot na versão ${REMOTE:0:7}"
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "$(date '+%F %T') build falhou, mantendo a versão anterior em execução"
  exit 1
fi
