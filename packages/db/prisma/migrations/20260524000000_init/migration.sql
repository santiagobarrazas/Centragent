CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_message_at" TIMESTAMPTZ,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "client_instance_id" TEXT,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_agents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "joined_at" TIMESTAMPTZ,
  "left_at" TIMESTAMPTZ,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_agents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "join_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "requested_role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "responded_at" TIMESTAMPTZ,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "sender_type" TEXT NOT NULL,
  "sender_id" UUID,
  "conversation_agent_id" UUID,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "conversation_agent_id" UUID,
  "agent_id" UUID,
  "user_message_id" UUID,
  "assistant_message_id" UUID,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "run_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "sequence_number" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "run_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "qdrant_memory" (
  "point_id" TEXT NOT NULL,
  "conversation_id" UUID,
  "agent_id" UUID,
  "conversation_agent_id" UUID,
  "message_id" UUID,
  "run_id" UUID,
  "scope_type" TEXT NOT NULL,
  "scope_id" UUID,
  "content" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qdrant_memory_pkey" PRIMARY KEY ("point_id")
);

CREATE INDEX "conversations_owner_id_idx" ON "conversations"("owner_id");
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");
CREATE INDEX "agents_owner_id_idx" ON "agents"("owner_id");
CREATE INDEX "agents_provider_client_instance_id_name_idx" ON "agents"("provider", "client_instance_id", "name");
CREATE UNIQUE INDEX "conversation_agents_conversation_id_agent_id_key" ON "conversation_agents"("conversation_id", "agent_id");
CREATE INDEX "conversation_agents_agent_id_idx" ON "conversation_agents"("agent_id");
CREATE INDEX "conversation_agents_conversation_id_status_idx" ON "conversation_agents"("conversation_id", "status");
CREATE INDEX "join_requests_conversation_id_status_idx" ON "join_requests"("conversation_id", "status");
CREATE INDEX "join_requests_agent_id_idx" ON "join_requests"("agent_id");
CREATE INDEX "join_requests_status_expires_at_idx" ON "join_requests"("status", "expires_at");
CREATE UNIQUE INDEX "messages_conversation_id_sequence_number_key" ON "messages"("conversation_id", "sequence_number");
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "messages_conversation_agent_id_idx" ON "messages"("conversation_agent_id");
CREATE INDEX "runs_conversation_id_idx" ON "runs"("conversation_id");
CREATE INDEX "runs_conversation_agent_id_idx" ON "runs"("conversation_agent_id");
CREATE INDEX "runs_agent_id_idx" ON "runs"("agent_id");
CREATE UNIQUE INDEX "run_events_run_id_sequence_number_key" ON "run_events"("run_id", "sequence_number");
CREATE INDEX "run_events_run_id_idx" ON "run_events"("run_id");
CREATE INDEX "qdrant_memory_conversation_id_idx" ON "qdrant_memory"("conversation_id");
CREATE INDEX "qdrant_memory_agent_id_idx" ON "qdrant_memory"("agent_id");
CREATE INDEX "qdrant_memory_message_id_idx" ON "qdrant_memory"("message_id");
CREATE INDEX "qdrant_memory_run_id_idx" ON "qdrant_memory"("run_id");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_agents"
  ADD CONSTRAINT "conversation_agents_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_agents"
  ADD CONSTRAINT "conversation_agents_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "join_requests"
  ADD CONSTRAINT "join_requests_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "join_requests"
  ADD CONSTRAINT "join_requests_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversation_agent_id_fkey"
  FOREIGN KEY ("conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_conversation_agent_id_fkey"
  FOREIGN KEY ("conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_user_message_id_fkey"
  FOREIGN KEY ("user_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "runs"
  ADD CONSTRAINT "runs_assistant_message_id_fkey"
  FOREIGN KEY ("assistant_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "run_events"
  ADD CONSTRAINT "run_events_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "qdrant_memory"
  ADD CONSTRAINT "qdrant_memory_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qdrant_memory"
  ADD CONSTRAINT "qdrant_memory_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qdrant_memory"
  ADD CONSTRAINT "qdrant_memory_conversation_agent_id_fkey"
  FOREIGN KEY ("conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qdrant_memory"
  ADD CONSTRAINT "qdrant_memory_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "qdrant_memory"
  ADD CONSTRAINT "qdrant_memory_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
