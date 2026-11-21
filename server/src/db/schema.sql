-- Multi-Document Workbench schema (SQLite). Idempotent: safe to run on every startup.
-- Facts (what documents say) and interpretation (AI findings) live in separate tables.

PRAGMA foreign_keys = ON;

-- Uploaded documents. extracted_text holds the parsed (possibly truncated) content.
CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  original_name   TEXT    NOT NULL,
  sanitized_name  TEXT    NOT NULL,
  mime_type       TEXT    NOT NULL,
  format          TEXT    CHECK (format IS NULL OR format IN ('pdf', 'txt', 'csv', 'image')),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  status          TEXT    NOT NULL CHECK (status IN ('uploaded', 'processing', 'processed', 'failed', 'unsupported')),
  error_message   TEXT,
  extracted_text  TEXT,
  char_count      INTEGER NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  was_truncated   INTEGER NOT NULL DEFAULT 0 CHECK (was_truncated IN (0, 1)),
  parse_info_json TEXT,
  created_at      TEXT    NOT NULL
);

-- One row per analysis run.
CREATE TABLE IF NOT EXISTS analyses (
  id                    TEXT PRIMARY KEY,
  instruction           TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  provider              TEXT NOT NULL CHECK (provider IN ('openai', 'mock')),
  summary               TEXT,
  comparison_table_json TEXT,
  error_message         TEXT,
  created_at            TEXT NOT NULL,
  completed_at          TEXT
);

-- Which documents an analysis covers.
CREATE TABLE IF NOT EXISTS analysis_documents (
  analysis_id TEXT NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_documents_document ON analysis_documents (document_id);

-- FACTS: extracted per document, within one analysis run.
CREATE TABLE IF NOT EXISTS extracted_facts (
  id               TEXT PRIMARY KEY,
  analysis_id      TEXT NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  document_id      TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  value            TEXT NOT NULL,
  normalized_value TEXT,
  category         TEXT NOT NULL CHECK (category IN ('identity', 'address', 'date', 'financial', 'obligation', 'licence', 'other')),
  source_snippet   TEXT NOT NULL CHECK (length(source_snippet) <= 200),
  confidence       REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
);
CREATE INDEX IF NOT EXISTS idx_extracted_facts_analysis_document ON extracted_facts (analysis_id, document_id);
CREATE INDEX IF NOT EXISTS idx_extracted_facts_document ON extracted_facts (document_id);

-- INTERPRETATION: AI findings across documents (discrepancies, summary points, missing info, ...).
CREATE TABLE IF NOT EXISTS findings (
  id          TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('comparison', 'discrepancy', 'missing_information', 'summary_point', 'key_value')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  severity    TEXT CHECK (severity IN ('low', 'medium', 'high')),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_analysis ON findings (analysis_id);

-- PROVENANCE: every finding must have >= 1 row here (enforced in the repository layer via zod).
CREATE TABLE IF NOT EXISTS finding_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id  TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  fact_id     TEXT REFERENCES extracted_facts (id) ON DELETE SET NULL,
  snippet     TEXT CHECK (snippet IS NULL OR length(snippet) <= 200)
);
CREATE INDEX IF NOT EXISTS idx_finding_sources_finding ON finding_sources (finding_id);
CREATE INDEX IF NOT EXISTS idx_finding_sources_document ON finding_sources (document_id);
