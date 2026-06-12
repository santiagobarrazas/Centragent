-- Constraints Prisma's schema language cannot express. Applied after
-- `prisma db push` by `pnpm --filter @centragent/db db:constraints`.
-- Written to be idempotent (drop-then-create) so it is safe to re-run.

-- === Memberships: exactly one principal, consistent with principal_type ======
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_one_principal_chk";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_one_principal_chk"
  CHECK (("user_id" IS NULL) <> ("agent_id" IS NULL));

ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_principal_type_chk";
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_principal_type_chk"
  CHECK (
    ("principal_type" = 'user'  AND "user_id"  IS NOT NULL AND "agent_id" IS NULL) OR
    ("principal_type" = 'agent' AND "agent_id" IS NOT NULL AND "user_id"  IS NULL)
  );

-- Real uniqueness: Postgres treats NULLs as distinct, so plain UNIQUE over
-- nullable discriminators would let duplicates through. Use partial indexes.
DROP INDEX IF EXISTS "memberships_user_project_uq";
CREATE UNIQUE INDEX "memberships_user_project_uq"
  ON "memberships" ("user_id", "project_id")
  WHERE "conversation_id" IS NULL AND "user_id" IS NOT NULL;

DROP INDEX IF EXISTS "memberships_agent_project_uq";
CREATE UNIQUE INDEX "memberships_agent_project_uq"
  ON "memberships" ("agent_id", "project_id")
  WHERE "conversation_id" IS NULL AND "agent_id" IS NOT NULL;

DROP INDEX IF EXISTS "memberships_user_conversation_uq";
CREATE UNIQUE INDEX "memberships_user_conversation_uq"
  ON "memberships" ("user_id", "conversation_id")
  WHERE "conversation_id" IS NOT NULL AND "user_id" IS NOT NULL;

DROP INDEX IF EXISTS "memberships_agent_conversation_uq";
CREATE UNIQUE INDEX "memberships_agent_conversation_uq"
  ON "memberships" ("agent_id", "conversation_id")
  WHERE "conversation_id" IS NOT NULL AND "agent_id" IS NOT NULL;

-- === API tokens: agent-bound iff kind = 'agent' ============================
ALTER TABLE "api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_kind_agent_chk";
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_kind_agent_chk"
  CHECK (
    ("kind" = 'agent' AND "agent_id" IS NOT NULL) OR
    ("kind" = 'user'  AND "agent_id" IS NULL)
  );

-- === Vector memory: private-note isolation invariant (security boundary) =====
-- Any private point must carry an owning agent; agent notes must be private.
-- A single missing payload field on upsert = cross-agent leak, so enforce here.
ALTER TABLE "qdrant_memory" DROP CONSTRAINT IF EXISTS "qdrant_memory_private_owner_chk";
ALTER TABLE "qdrant_memory" ADD CONSTRAINT "qdrant_memory_private_owner_chk"
  CHECK ("visibility" = 'shared' OR "owner_agent_id" IS NOT NULL);

ALTER TABLE "qdrant_memory" DROP CONSTRAINT IF EXISTS "qdrant_memory_agent_note_chk";
ALTER TABLE "qdrant_memory" ADD CONSTRAINT "qdrant_memory_agent_note_chk"
  CHECK (
    "scope_type" <> 'agent_note'
    OR ("visibility" = 'private' AND "owner_agent_id" IS NOT NULL)
  );

-- === Documents: agent notes are always private =============================
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_notes_private_chk";
ALTER TABLE "documents" ADD CONSTRAINT "documents_notes_private_chk"
  CHECK (
    "kind" <> 'agent_notes'
    OR ("is_private" = true AND "visibility" = 'private')
  );
