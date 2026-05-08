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

# 安全 review H3：失败时清理半成品 + 显式 PIPESTATUS 校验
#
# pipefail 已让任一阶段失败整体退出，但 trap ERR 让错误时清掉损坏的部分文件
# （避免下次清理脚本误以为有效备份留 14 天占空间）。
trap 'rc=$?; if [ -f "$BACKUP_FILE" ]; then echo "ERROR: backup pipeline failed (rc=$rc), removing partial $BACKUP_FILE" >&2; rm -f "$BACKUP_FILE"; fi; exit $rc' ERR

# pg_dump → gzip → age 加密 → 落盘
pg_dump -Fc "$DB_NAME" \
    | gzip -9 \
    | age -r "$AGE_PUBKEY" \
    > "$BACKUP_FILE"

# 安全 review H3：显式校验 PIPESTATUS（pipefail 已做但显式更稳）
# 任一非 0 即失败 → trap 清理 + 退出
for status in "${PIPESTATUS[@]}"; do
    if [ "$status" -ne 0 ]; then
        echo "ERROR: pipe stage failed (status=$status)" >&2
        false  # 触发 trap ERR
    fi
done

# 安全 review H3：阈值提至 10KB
# pg_dump 空库 + gzip + age 头 ~ 800B；真实 5 人小库压缩后 50KB+；
# 1KB 阈值过低让"中断流写了 1KB 部分密文"通过校验。10KB 平衡误报/漏报。
SIZE=$(stat -c%s "$BACKUP_FILE")
if [ "$SIZE" -lt 10240 ]; then
    echo "ERROR: backup file too small ($SIZE bytes < 10KB), likely truncated" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 安全 review H3：age magic header 校验
# age v1 文件以 "age-encryption.org/v1\n" 起始；中断流不会有完整 header
# 注：完整 round-trip 解密需要 private key（仅在管理员 Mac），atlas 上不可行；
# 这是降级实现 —— 至少证明 age 写完了 header。运维定期手动从 Mac 端
# 拉一份解密验证（建议 monthly）：
#   scp atlas:/var/backups/ghostterm/<latest>.age /tmp/
#   age -d -i ~/.config/age/ghostterm-backup.key /tmp/<file>.age | gunzip | head -c 100
AGE_MAGIC=$(head -c 22 "$BACKUP_FILE" || true)
if [ "$AGE_MAGIC" != "age-encryption.org/v1" ]; then
    echo "ERROR: backup file missing age v1 magic header (got: $AGE_MAGIC)" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# 安全 review L8：stat -c%s 是 GNU coreutils 语法，BSD/macOS 用 stat -f%z；
# 此脚本仅在 Ubuntu 24.04 (atlas) 跑不需 portability，但若后续迁 macOS 需改。
#
# 清理过期备份
find "$BACKUP_DIR" -name "progress_*.sql.gz.age" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $BACKUP_FILE ($(numfmt --to=iec $SIZE))"
