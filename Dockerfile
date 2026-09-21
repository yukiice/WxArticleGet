# 多阶段构建：build 阶段装全量依赖并编译，runtime 只留 standalone + dist + 生产依赖。
# 四个服务（migrate/api/worker/web）共用一个镜像，避免 migrate 用旧镜像导致迁移不生效。

ARG NODE_BUILD_IMAGE=node:24-bookworm
ARG NODE_RUNTIME_IMAGE=node:24-bookworm-slim

# ---------- 构建阶段 ----------
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org

# 构建代理由 Docker 预定义的 proxy build args 注入，不写入运行镜像的 ENV
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

ENV NEXT_TELEMETRY_DISABLED=1
# Corepack 下载 pnpm 的 registry 需要单独配置
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

# 先复制清单以获得更好的层缓存
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile --registry="${NPM_REGISTRY}"

COPY . .

# Prisma 的查询引擎依赖 OpenSSL（node:*-slim 默认不带）
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# rewrites 在构建时求值并固化进 standalone，运行时的环境变量改不动它，
# 因此这里必须用容器网络内的服务名，不能用 localhost
ENV API_INTERNAL_URL=http://api:3001
ENV DATA_DIR=/data

RUN pnpm build

# ---------- 运行阶段 ----------
#
# 同时带 standalone 与完整 node_modules：
#
# standalone 只含 Next 追踪到的依赖，供 server.js 运行用，体积小。
# 但 api / worker 是独立入口（node dist/main.js），Next 的追踪看不到它们。
# pnpm 用符号链接做依赖隔离：workspace 各包的依赖装在各自的 node_modules 里，
# 只复制根 node_modules 会得到断链（实测 reflect-metadata 找不到），因此逐个复制。
#
# 代价是镜像含 devDependencies（prisma CLI 要在容器内跑 migrate）。换来的是
# 四个服务共用一个镜像，且不依赖 Next tracing 与 pnpm 目录结构的实现细节。
FROM ${NODE_RUNTIME_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/data
# standalone 的 server.js 只读 process.env.PORT；不再有 next start -p 3000 这层显式传参
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 appgroup \
  && useradd --system --uid 1001 --gid appgroup appuser

COPY --from=build --chown=1001:1001 /app/node_modules ./node_modules
# standalone 放最前：它内部只带 Next trace 到的少量依赖（本项目实测仅 typescript），
# 放在前面可确保后面完整 node_modules 的拷贝最终生效，避免依赖被它覆盖掉。
COPY --from=build --chown=1001:1001 /app/apps/web/.next/standalone/ ./
COPY --from=build --chown=1001:1001 /app/apps/web/.next/static ./apps/web/.next/static

# workspace 各包自己的 node_modules（pnpm 的符号链接在这里），必须逐个带上
COPY --from=build --chown=1001:1001 /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=1001:1001 /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=1001:1001 /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build --chown=1001:1001 /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build --chown=1001:1001 /app/packages/email/node_modules ./packages/email/node_modules
COPY --from=build --chown=1001:1001 /app/packages/queue/node_modules ./packages/queue/node_modules
COPY --from=build --chown=1001:1001 /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=1001:1001 /app/packages/wechat/node_modules ./packages/wechat/node_modules
# workspace 包的 package.json：@wx/shared/node 这类子路径导出靠它解析
COPY --from=build --chown=1001:1001 /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=1001:1001 /app/packages/email/package.json ./packages/email/package.json
COPY --from=build --chown=1001:1001 /app/packages/queue/package.json ./packages/queue/package.json
COPY --from=build --chown=1001:1001 /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=1001:1001 /app/packages/wechat/package.json ./packages/wechat/package.json
COPY --from=build --chown=1001:1001 /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=1001:1001 /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=1001:1001 /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=1001:1001 /app/packages/db/prisma ./packages/db/prisma
COPY --from=build --chown=1001:1001 /app/packages/email/dist ./packages/email/dist
COPY --from=build --chown=1001:1001 /app/packages/queue/dist ./packages/queue/dist
COPY --from=build --chown=1001:1001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=1001:1001 /app/packages/wechat/dist ./packages/wechat/dist
COPY --from=build --chown=1001:1001 /app/package.json ./package.json

# 统一入口：migrate / api / worker / web 四个子命令，见 scripts/docker-entrypoint.sh
COPY --chown=1001:1001 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER 1001:1001
EXPOSE 3000 3001

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
