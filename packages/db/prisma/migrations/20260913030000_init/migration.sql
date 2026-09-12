-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `biz` VARCHAR(128) NOT NULL,
    `avatarUrl` TEXT NULL,
    `intro` TEXT NULL,
    `providerType` VARCHAR(32) NOT NULL DEFAULT 'manual',
    `providerConfig` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `lastFetchAt` DATETIME(3) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_biz_key`(`biz`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `articles` (
    `id` VARCHAR(32) NOT NULL,
    `accountId` VARCHAR(32) NOT NULL,
    `biz` VARCHAR(128) NOT NULL,
    `mid` VARCHAR(64) NOT NULL,
    `idx` INTEGER NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `author` VARCHAR(191) NULL,
    `publishTime` DATETIME(3) NOT NULL,
    `url` TEXT NOT NULL,
    `urlHash` VARCHAR(64) NOT NULL,
    `coverUrl` TEXT NULL,
    `coverLocal` TEXT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `contentText` LONGTEXT NOT NULL,
    `digest` TEXT NULL,
    `wordCount` INTEGER NOT NULL DEFAULT 0,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `processed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `articles_urlHash_key`(`urlHash`),
    INDEX `articles_publishTime_idx`(`publishTime`),
    INDEX `articles_accountId_publishTime_idx`(`accountId`, `publishTime`),
    UNIQUE INDEX `articles_biz_mid_idx_key`(`biz`, `mid`, `idx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `article_images` (
    `id` VARCHAR(32) NOT NULL,
    `articleId` VARCHAR(32) NOT NULL,
    `originalUrl` TEXT NOT NULL,
    `originalUrlHash` VARCHAR(64) NOT NULL,
    `localPath` VARCHAR(512) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `article_images_articleId_originalUrlHash_key`(`articleId`, `originalUrlHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `summaries` (
    `id` VARCHAR(32) NOT NULL,
    `date` DATE NOT NULL,
    `scope` VARCHAR(32) NOT NULL DEFAULT 'global',
    `accountId` VARCHAR(32) NULL,
    `model` VARCHAR(64) NOT NULL,
    `promptVer` VARCHAR(32) NOT NULL,
    `contentMd` LONGTEXT NOT NULL,
    `articleCount` INTEGER NOT NULL DEFAULT 0,
    `tokenIn` INTEGER NOT NULL DEFAULT 0,
    `tokenOut` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'done',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `summaries_date_scope_accountId_key`(`date`, `scope`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_recipients` (
    `id` VARCHAR(32) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `email_recipients_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `send_logs` (
    `id` VARCHAR(32) NOT NULL,
    `date` DATE NOT NULL,
    `subject` VARCHAR(512) NOT NULL,
    `recipients` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `send_logs_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_logs` (
    `id` VARCHAR(32) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `accountId` VARCHAR(32) NULL,
    `status` VARCHAR(16) NOT NULL,
    `newCount` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `job_logs_accountId_startedAt_idx`(`accountId`, `startedAt`),
    INDEX `job_logs_type_startedAt_idx`(`type`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(32) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'member',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feed_catalog` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `feedUrl` VARCHAR(512) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `biz` VARCHAR(128) NULL,
    `avatarUrl` TEXT NULL,
    `intro` TEXT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `feed_catalog_feedUrl_key`(`feedUrl`),
    INDEX `feed_catalog_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_queue` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `payload` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `runAt` DATETIME(3) NOT NULL,
    `singletonKey` VARCHAR(128) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `job_queue_status_runAt_idx`(`status`, `runAt`),
    INDEX `job_queue_name_status_idx`(`name`, `status`),
    INDEX `job_queue_singletonKey_status_idx`(`singletonKey`, `status`),
    INDEX `job_queue_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `articles` ADD CONSTRAINT `articles_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `article_images` ADD CONSTRAINT `article_images_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `articles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `job_logs` ADD CONSTRAINT `job_logs_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

