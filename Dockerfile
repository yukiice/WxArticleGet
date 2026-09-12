FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# Prisma 的查询引擎依赖 OpenSSL（node:*-slim 默认不带）
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

# 前端在容器网络内访问 API，如需其他地址可在 compose 中覆盖
ENV API_INTERNAL_URL=http://api:3001
ENV DATA_DIR=/data

RUN pnpm build

EXPOSE 3000 3001

CMD ["pnpm", "--filter", "@wx/api", "start"]
