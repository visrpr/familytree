ALTER TABLE edit_log ADD COLUMN idem_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_edit_log_idem_key ON edit_log(idem_key) WHERE idem_key IS NOT NULL;