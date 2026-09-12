-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "biz" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "intro" TEXT,
    "providerType" TEXT NOT NULL DEFAULT 'manual',
    "providerConfig" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastFetchAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "biz" TEXT NOT NULL,
    "mid" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publishTime" TIMESTAMPTZ(3) NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "coverUrl" TEXT,
    "coverLocal" TEXT,
    "contentHtml" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "digest" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_images" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summaries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "accountId" TEXT,
    "model" TEXT NOT NULL,
    "promptVer" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "tokenIn" INTEGER NOT NULL DEFAULT 0,
    "tokenOut" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'done',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_logs" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "subject" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountId" TEXT,
    "status" TEXT NOT NULL,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_biz_key" ON "accounts"("biz");

-- CreateIndex
CREATE UNIQUE INDEX "articles_urlHash_key" ON "articles"("urlHash");

-- CreateIndex
CREATE INDEX "articles_publishTime_idx" ON "articles"("publishTime");

-- CreateIndex
CREATE INDEX "articles_accountId_publishTime_idx" ON "articles"("accountId", "publishTime");

-- CreateIndex
CREATE UNIQUE INDEX "articles_biz_mid_idx_key" ON "articles"("biz", "mid", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "article_images_articleId_originalUrl_key" ON "article_images"("articleId", "originalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "summaries_date_scope_accountId_key" ON "summaries"("date", "scope", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_email_key" ON "email_recipients"("email");

-- CreateIndex
CREATE INDEX "send_logs_date_idx" ON "send_logs"("date");

-- CreateIndex
CREATE INDEX "job_logs_accountId_startedAt_idx" ON "job_logs"("accountId", "startedAt");

-- CreateIndex
CREATE INDEX "job_logs_type_startedAt_idx" ON "job_logs"("type", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

