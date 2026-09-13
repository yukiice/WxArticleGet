-- AlterTable
ALTER TABLE `summaries` ADD COLUMN `windowFrom` DATETIME(3) NULL,
                       ADD COLUMN `windowTo` DATETIME(3) NULL;
