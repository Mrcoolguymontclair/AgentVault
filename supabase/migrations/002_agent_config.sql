-- Add extended fields to agents table for deploy flow
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) DEFAULT 1000;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT 'groq_llama';

-- Index for private/public queries
CREATE INDEX IF NOT EXISTS idx_agents_is_private ON agents (is_private);
