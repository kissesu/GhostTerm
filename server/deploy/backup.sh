#!/bin/bash
# @file backup.sh
# @description GhostTerm 备份脚本：pg_dump + age 加密 + 离场 (finding #19)
#
# 业务背景：
#   - age 非对称加密，pubkey 在云上 /etc/ghostterm/age.pub，私钥仅在本机 Mac
#   - 磁盘快照拿到密文备份也无法解密（除非同时拿到 Mac 私钥）
#   - 14 天滚动清理 + 文件大小校验防 silent fail
#
# @author Atlas.oi
# @date 2026-05-08

set -euo pipefail

BACKUP_DIR="/var/backups/ghostterm"
RETENTION_DAYS=14
AGE_PUBKEY_FILE="/etc/ghostterm/age.pub"
DB_NAME="${PGDATABASE:-progress}"

if [ ! -f "$AGE_PUBKEY_FILE" ]; then
    echo "ERROR: age public key not found at $AGE_PUBKEY_FILE" >&2
    echo "Run: scp ~/.config/age/ghostterm-backup.pub atlas:/etc/ghostterm/age.pub" >&2
    exit 1
fi

if ! command -v age >/dev/null 2>&1; then
    echo "ERROR: age binary not found. Install: sudo apt install -y age" >&2
    exit 1
fi

AGE_PUBKEY=$(cat "$AGE_PUBKEY_FILE")
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/progress_${DATE}.sql.gz.age"

mkdir -p "$BACKUP_DIR"

# pg_dump → gzip → age 加密 → 落盘
# pipefail 确保任一阶段失败整体失败
pg_dump -Fc "$DB_NAME" \
    | gzip -9 \
    | age -r "$AGE_PUBKEY" \
    > "$BACKUP_FILE"

# 校验产物大小，防 silent fail
SIZE=$(stat -c%s "$BACKUP_FILE")
if [ "$SIZE" -lt 1024 ]; then
    echo "ERROR: backup file too small ($SIZE bytes), likely failed" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 清理过期备份
find "$BACKUP_DIR" -name "progress_*.sql.gz.age" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_FILE ($(numfmt --to=iec $SIZE))"
