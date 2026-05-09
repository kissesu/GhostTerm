-- 回滚 0028：删除 key 版本列
ALTER TABLE feedbacks DROP COLUMN IF EXISTS content_key_version;
ALTER TABLE payments  DROP COLUMN IF EXISTS remark_key_version;
