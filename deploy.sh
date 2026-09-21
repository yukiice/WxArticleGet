#!/usr/bin/env bash
# 首次部署、代码更新、失败后重试均执行：bash deploy.sh
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
trap 'echo "部署失败（第 $LINENO 行）。修复上方错误后重新执行 bash deploy.sh；.env 和数据不会被脚本删除。" >&2' ERR

for tool in git docker flock; do
  command -v "$tool" >/dev/null || { echo "缺少命令：$tool" >&2; exit 1; }
done
# 防止两个更新命令同时运行；重载脚本时沿用此锁。
if [[ ${WX_DEPLOY_RELOADED:-0} != 1 ]]; then
  exec 9>"$(git rev-parse --git-path deploy.lock)"
  flock -n 9 || { echo '另一个部署正在运行，请等待完成。' >&2; exit 1; }
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
    echo '仓库有未提交修改，请先保存或提交；脚本不会强制覆盖你的改动。' >&2; exit 1;
  }
  branch="$(git symbolic-ref --quiet --short HEAD)" || { echo '请先切换到要部署的分支。' >&2; exit 1; }
  remote="$(git config --get "branch.$branch.remote" || echo origin)"
  ref="$(git config --get "branch.$branch.merge" || echo "refs/heads/$branch")"
  echo "更新代码：$remote $ref"
  git fetch "$remote" "$ref"
  # 本地提交领先或分叉时停止，避免把本地试验代码误当成远端发布。
  git merge-base --is-ancestor HEAD FETCH_HEAD || {
    echo '本地分支与远端不一致，请先处理本地提交；脚本不会 reset --hard。' >&2; exit 1;
  }
  previous="$(git rev-parse HEAD)"
  git merge --ff-only FETCH_HEAD
  if [[ "$previous" != "$(git rev-parse HEAD)" ]]; then
    # 本次更新可能也改了部署脚本，立即使用新脚本完成后续步骤。
    export WX_DEPLOY_RELOADED=1
    exec bash "$ROOT/deploy.sh"
  fi
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo '已生成 .env。请配置 DATABASE_URL、AUTH_SECRET、ADMIN_PASSWORD、APP_BASE_URL，再运行 bash deploy.sh。'
  exit 1
fi
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null && docker-compose version --short | grep -qE '^v?2\.'; then
  compose=(docker-compose)
else
  echo '需要 Docker Compose v2，请先安装 docker-compose-plugin。' >&2; exit 1
fi
# 显式传入文件，绕过旧 .env 中的 COMPOSE_FILE 以及遗留 override 文件。
compose+=(--project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/docker-compose.yml")
docker info >/dev/null
"${compose[@]}" config --quiet
echo '构建应用镜像（复用已有依赖和基础镜像缓存）…'
"${compose[@]}" build app
echo '检查数据库连接并应用迁移…'
"${compose[@]}" run --rm --no-deps app node dist/migrate.js

# 升级旧版时仅停止本项目的 web/api/worker，保留现有数据库及所有数据卷。
# 不使用 down 或 --remove-orphans，避免误删旧项目下的 MySQL 容器。
legacy=()
ids="$("${compose[@]}" ps --all --quiet --orphans)"
while IFS= read -r id; do
  [[ -n "$id" ]] || continue
  service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"
  case "$service" in web|api|worker) legacy+=("$id");; esac
done <<< "$ids"
if (( ${#legacy[@]} )); then docker stop --time 60 "${legacy[@]}"; fi

echo '启动应用并等待健康检查…'
"${compose[@]}" up -d --no-build app
id="$("${compose[@]}" ps --all --quiet app)"
for ((attempt=0; attempt<60; attempt++)); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$id")"
  case "$status" in
    healthy)
      echo "部署成功，版本 $(git rev-parse --short HEAD)。访问 .env 中的 APP_BASE_URL。"
      "${compose[@]}" ps app
      exit 0;;
    unhealthy) break;;
  esac
  sleep 2
done
"${compose[@]}" logs --tail 80 app
echo '应用未通过健康检查，请检查上方日志、数据库地址和 .env。' >&2
exit 1
