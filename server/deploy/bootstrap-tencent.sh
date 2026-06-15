#!/usr/bin/env bash
# @file bootstrap-tencent.sh
# @description GhostTerm 腾讯云 Lighthouse 首次部署一键脚本(幂等)
#
# 前置(host 端,本脚本前已完成):
#   /opt/ghostterm/                  ← 仓库这次新建
#     ├─ bin/ghostterm-server        ← Mac cross-compile + scp 上来
#     ├─ migrations/                 ← scp 整目录上来
#     ├─ docker-compose.prod.yml     ← scp
#     ├─ Caddyfile.prod              ← scp
#     └─ bootstrap-tencent.sh        ← 本脚本
#
# 脚本职责:
#   1. 创建 /etc/ghostterm/ 目录结构(secrets/ + age.pub + cert/key)
#   2. 若 secrets 不存在则生成(JWT × 2 + pg_root_pw + pg_app_pw + data_key)
#   3. 若 cert/key 不存在则签自签证书(CA:FALSE + serverAuth EKU)
#   4. 渲染 /etc/ghostterm/server.env(从 secrets 拼 DATABASE_URL)
#   5. docker compose up postgres → 等 healthy → migrate up → ALTER ROLE jit=off + 设 progress_app 密码
#   6. docker compose up ghostterm-server + caddy
#   7. 内网 curl healthz 验收
#
# 幂等性:secret/cert 已存在则不重生(避免重跑覆盖密钥);compose up 自动 reconcile
#
# @author Atlas.oi
# @date 2026-06-15

set -euo pipefail

ROOT=/opt/ghostterm
ETC=/etc/ghostterm
SECRETS=$ETC/secrets
HOST_IP=129.28.42.191

if [ "$EUID" -ne 0 ]; then
  echo "ERROR: 必须 root 跑(secrets 目录权限要求)" >&2
  exit 1
fi

cd "$ROOT"

# ── 1. 目录骨架 ──
install -d -m 755 "$ETC"
install -d -m 700 "$SECRETS"
install -d -m 755 /var/log/ghostterm

# ── 2. secrets(已存在不重生)──
# pg 密码用 hex(避免 / + = 污染 DATABASE_URL),JWT 用 base64(满足 server config
# ≥3 字符类的熵检查:lower + upper + digit/+/=)
gen_hex()    { openssl rand -hex "$1"; }
gen_base64() { openssl rand -base64 "$1" | tr -d '\n'; }

[ -s "$SECRETS/pg_root_pw"   ] || { gen_hex    24 > "$SECRETS/pg_root_pw";   chmod 600 "$SECRETS/pg_root_pw"; }
[ -s "$SECRETS/pg_app_pw"    ] || { gen_hex    24 > "$SECRETS/pg_app_pw";    chmod 600 "$SECRETS/pg_app_pw"; }
[ -s "$SECRETS/jwt_access"   ] || { gen_base64 32 > "$SECRETS/jwt_access";   chmod 600 "$SECRETS/jwt_access"; }
[ -s "$SECRETS/jwt_refresh"  ] || { gen_base64 32 > "$SECRETS/jwt_refresh";  chmod 600 "$SECRETS/jwt_refresh"; }
[ -s "$SECRETS/data_key"     ] || { gen_base64 32 > "$SECRETS/data_key";     chmod 600 "$SECRETS/data_key"; }

PG_ROOT_PW=$(cat "$SECRETS/pg_root_pw")
PG_APP_PW=$(cat "$SECRETS/pg_app_pw")
JWT_ACCESS=$(cat "$SECRETS/jwt_access")
JWT_REFRESH=$(cat "$SECRETS/jwt_refresh")
GT_DATA_KEY=$(cat "$SECRETS/data_key")

# ── 3. 自签 IP 证书(已存在不重签;过期/换 IP 时手动删后再跑)──
#    必带 3 个 ext(CA:FALSE + keyUsage + serverAuth EKU),否则 rustls webpki 拒
if [ ! -s "$ETC/cert.pem" ] || [ ! -s "$ETC/key.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$ETC/key.pem" \
    -out    "$ETC/cert.pem" \
    -subj   "/CN=${HOST_IP}" \
    -addext "subjectAltName=IP:${HOST_IP},IP:127.0.0.1,DNS:localhost" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"
  chmod 644 "$ETC/cert.pem"
  chmod 640 "$ETC/key.pem"
fi

# ── 4. 渲染 server.env(含 DATABASE_URL 完整串)──
#    progress_app 角色由 0001 migration 创建为 NOBYPASSRLS,密码本脚本设
cat >"$ETC/server.env" <<EOF
# 由 bootstrap-tencent.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) 生成
DATABASE_URL=postgres://progress_app:${PG_APP_PW}@postgres:5432/progress?sslmode=disable
JWT_ACCESS_SECRET=${JWT_ACCESS}
JWT_REFRESH_SECRET=${JWT_REFRESH}
GT_DATA_KEY=${GT_DATA_KEY}
HTTP_ADDR=:8080
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=168h
BCRYPT_COST=12
FILE_STORAGE_PATH=/var/lib/ghostterm/files
FILE_MAX_SIZE_MB=100
RATE_LIMIT_LOGIN_PER_MIN_PER_IP=5
RATE_LIMIT_LOGIN_PER_MIN_PER_USER=10
RATE_LIMIT_REFRESH_PER_MIN_PER_IP=30
TRUSTED_PROXIES=172.16.0.0/12
ALLOWED_ORIGINS=
EOF
chmod 640 "$ETC/server.env"

# ── 5. 起 postgres + migrate ──
docker compose -f "$ROOT/docker-compose.prod.yml" up -d postgres

echo "等 postgres healthy..."
for i in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' ghostterm-postgres 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  sleep 2
done
[ "$state" = "healthy" ] || { echo "postgres 启动失败" >&2; exit 1; }

# migrate 一次性 job(用 docker run --rm,挂同网络 + secrets bind)
docker run --rm \
  --network ghostterm \
  -v "$ROOT/migrations:/migrations:ro" \
  migrate/migrate:v4.19.1 \
  -path=/migrations \
  -database="postgres://postgres:${PG_ROOT_PW}@postgres:5432/progress?sslmode=disable" \
  up

# 设 progress_app 密码 + 永久关 JIT(避免 RLS view 反优化)
docker exec -e PGPASSWORD="$PG_ROOT_PW" ghostterm-postgres \
  psql -U postgres -d progress -c \
  "ALTER ROLE progress_app PASSWORD '${PG_APP_PW}'; ALTER ROLE progress_app SET jit = off;"

# ── 6. 起业务服务 ──
docker compose -f "$ROOT/docker-compose.prod.yml" up -d ghostterm-server caddy

# ── 7. 验收 ──
echo "等 ghostterm-server healthy..."
for i in $(seq 1 30); do
  state=$(docker inspect -f '{{.State.Health.Status}}' ghostterm-server 2>/dev/null || echo starting)
  [ "$state" = "healthy" ] && break
  sleep 2
done
[ "$state" = "healthy" ] || { echo "ghostterm-server 启动失败" >&2; docker logs --tail 50 ghostterm-server >&2; exit 1; }

echo "本地 curl https://${HOST_IP}:38080/healthz:"
curl -sk "https://${HOST_IP}:38080/healthz" | head -200
echo

echo "✓ bootstrap 完成"
echo "  Secrets:   ${SECRETS}/{pg_root_pw,pg_app_pw,jwt_access,jwt_refresh}"
echo "  Server cfg: ${ETC}/server.env"
echo "  Cert/Key:  ${ETC}/cert.pem ${ETC}/key.pem"
echo "  Compose:   ${ROOT}/docker-compose.prod.yml"
echo "  下一步:把 ${ETC}/cert.pem 拉回 Mac 编入 src-tauri/certs/tencent-ip.pem"
