ALTER TABLE `users` ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `summaries` ADD COLUMN `fetchJobIds` JSON NULL;
ALTER TABLE `send_logs` ADD COLUMN `windowFrom` DATETIME(3) NULL,
                        ADD COLUMN `windowTo` DATETIME(3) NULL;

-- 旧日志仅在有实际统计边界时回填，不用发信时间推测统计范围。
UPDATE `send_logs` AS l
JOIN `summaries` AS s ON s.`date` = l.`date` AND s.`scope` = 'global'
SET l.`windowFrom` = s.`windowFrom`, l.`windowTo` = s.`windowTo`
WHERE s.`windowFrom` IS NOT NULL AND s.`windowTo` IS NOT NULL;

UPDATE `job_queue` SET `singletonKey` = NULL WHERE `status` NOT IN ('pending', 'running');
-- 保留旧队列中的工作，只解除迁移前已存在的重复键；新任务由唯一索引防重。
UPDATE `job_queue` AS newer
JOIN `job_queue` AS older ON newer.`singletonKey` = older.`singletonKey`
  AND (newer.`createdAt` > older.`createdAt`
       OR (newer.`createdAt` = older.`createdAt` AND newer.`id` > older.`id`))
SET newer.`singletonKey` = NULL;
DROP INDEX `job_queue_singletonKey_status_idx` ON `job_queue`;
CREATE UNIQUE INDEX `job_queue_singletonKey_key` ON `job_queue` (`singletonKey`);
