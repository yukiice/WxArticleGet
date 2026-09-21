#!/bin/sh
# 统一容器入口：一个镜像支撑 migrate / api / worker / web 四个角色。
# 用法（compose 的 command 就是这里的第一个参数）：
#   migrate | api | worker | web
set -e

ROLE="${1:-api}"
shift || true

case "$ROLE" in
  migrate)
    # prisma migrate deploy 需要 prisma CLI、schema 与 migrations 目录
    cd /app/packages/db
    exec pnpm exec prisma migrate deploy
    ;;
  api)
    cd /app/apps/api
    exec node dist/main.js
    ;;
  worker)
    cd /app/apps/worker
    exec node dist/main.js
    ;;
  web)
    # standalone 产物的 server.js 就在镜像内的 apps/web 下
    cd /app/apps/web
    exec node server.js
    ;;
  *)
    echo "未知角色：$ROLE（可用：migrate | api | worker | web）" >&2
    exit 2
    ;;
esac
