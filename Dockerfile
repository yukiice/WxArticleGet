# 同一 Node 进程运行页面、API 和定时任务。
ARG NODE_IMAGE=node:24-bookworm
FROM ${NODE_IMAGE} AS base
# 完整版已包含 Prisma 所需的 OpenSSL，不在部署时安装系统包。
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PRISMA_ENGINES_MIRROR=https://cdn.npmmirror.com/binaries/prisma
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
ENV PRISMA_ENGINES_MIRROR=${PRISMA_ENGINES_MIRROR}
RUN corepack enable
# 先按锁文件下载依赖，业务代码更新不会导致全部重新下载。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm config set registry "${NPM_REGISTRY}" && pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile \
    && pnpm build \
    && pnpm --filter @wx/app deploy --prod --legacy /out \
    && cd /out \
    && node -e "const p=require('node:path'),d=p.dirname(require.resolve('@wx/db/package.json')); require('node:child_process').execFileSync(process.execPath,[require.resolve('prisma/build/index.js',{paths:[d]}),'generate','--schema',p.join(d,'prisma/schema.prisma')],{stdio:'inherit'})" \
    && rm -rf /out/.next/cache

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
COPY --from=build --chown=1001:1001 /out ./
# 沿用旧镜像 UID，已有 appdata 卷无需更改权限。
RUN groupadd --system --gid 1001 appgroup \
    && useradd --system --uid 1001 --gid appgroup appuser \
    && mkdir /data && chown 1001:1001 /data /app
USER 1001:1001
EXPOSE 3000
CMD ["node", "dist/main.js"]
