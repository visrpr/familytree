CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  maiden_name TEXT,
  gender TEXT NOT NULL DEFAULT 'unknown',
  birth TEXT NOT NULL DEFAULT '',
  death TEXT NOT NULL DEFAULT '',
  spouse_id TEXT,
  children_json TEXT NOT NULL DEFAULT '[]',
  parents_json TEXT NOT NULL DEFAULT '[]',
  siblings_json TEXT NOT NULL DEFAULT '[]',
  marriage TEXT,
  divorce TEXT,
  description TEXT,
  phone TEXT,
  email TEXT,
  address TEXT
);