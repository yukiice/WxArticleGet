-- CreateTable
CREATE TABLE "feed_catalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "biz" TEXT,
    "avatarUrl" TEXT,
    "intro" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feed_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_catalog_feedUrl_key" ON "feed_catalog"("feedUrl");

-- CreateIndex
CREATE INDEX "feed_catalog_name_idx" ON "feed_catalog"("name");
