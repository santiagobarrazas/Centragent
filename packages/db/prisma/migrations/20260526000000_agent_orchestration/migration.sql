ALTER TABLE "agents" ADD COLUMN "handle" TEXT;
ALTER TABLE "agents" ADD COLUMN "last_seen_at" TIMESTAMPTZ;

UPDATE "agents"
SET "handle" = 'agent-' || replace(substring("id"::text from 1 for 8), '-', '')
WHERE "handle" IS NULL;

ALTER TABLE "agents" ALTER COLUMN "handle" SET NOT NULL;

CREATE UNIQUE INDEX "agents_handle_key" ON "agents"("handle");

CREATE TABLE "agent_presence" (
  "agent_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "status_message" TEXT,
  "active_conversation_id" UUID,
  "active_conversation_agent_id" UUID,
  "activity_title" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_presence_pkey" PRIMARY KEY ("agent_id")
);

CREATE TABLE "agent_activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agent_id" UUID NOT NULL,
  "conversation_id" UUID,
  "conversation_agent_id" UUID,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" TEXT NOT NULL,
  "conversation_id" UUID,
  "message_id" UUID,
  "actor_type" TEXT,
  "actor_id" UUID,
  "target_agent_id" UUID,
  "target_conversation_agent_id" UUID,
  "title" TEXT,
  "content" TEXT,
  "data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_event_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "conversation_agent_id" UUID,
  "status" TEXT NOT NULL,
  "delivered_at" TIMESTAMPTZ,
  "acknowledged_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_event_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_presence_status_idx" ON "agent_presence"("status");
CREATE INDEX "agent_presence_active_conversation_id_idx" ON "agent_presence"("active_conversation_id");
CREATE INDEX "agent_presence_active_conversation_agent_id_idx" ON "agent_presence"("active_conversation_agent_id");
CREATE INDEX "agent_activities_agent_id_status_idx" ON "agent_activities"("agent_id", "status");
CREATE INDEX "agent_activities_conversation_id_idx" ON "agent_activities"("conversation_id");
CREATE INDEX "agent_activities_conversation_agent_id_idx" ON "agent_activities"("conversation_agent_id");
CREATE INDEX "agent_events_conversation_id_created_at_idx" ON "agent_events"("conversation_id", "created_at");
CREATE INDEX "agent_events_message_id_idx" ON "agent_events"("message_id");
CREATE INDEX "agent_events_target_agent_id_created_at_idx" ON "agent_events"("target_agent_id", "created_at");
CREATE INDEX "agent_events_target_conversation_agent_id_created_at_idx" ON "agent_events"("target_conversation_agent_id", "created_at");
CREATE INDEX "agent_events_type_created_at_idx" ON "agent_events"("type", "created_at");
CREATE UNIQUE INDEX "agent_event_deliveries_event_id_agent_id_conversation_agent_id_key"
  ON "agent_event_deliveries"("event_id", "agent_id", "conversation_agent_id");
CREATE INDEX "agent_event_deliveries_agent_id_status_created_at_idx"
  ON "agent_event_deliveries"("agent_id", "status", "created_at");
CREATE INDEX "agent_event_deliveries_conversation_agent_id_status_idx"
  ON "agent_event_deliveries"("conversation_agent_id", "status");

ALTER TABLE "agent_presence"
  ADD CONSTRAINT "agent_presence_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_presence"
  ADD CONSTRAINT "agent_presence_active_conversation_id_fkey"
  FOREIGN KEY ("active_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_presence"
  ADD CONSTRAINT "agent_presence_active_conversation_agent_id_fkey"
  FOREIGN KEY ("active_conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_activities"
  ADD CONSTRAINT "agent_activities_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_activities"
  ADD CONSTRAINT "agent_activities_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_activities"
  ADD CONSTRAINT "agent_activities_conversation_agent_id_fkey"
  FOREIGN KEY ("conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_target_agent_id_fkey"
  FOREIGN KEY ("target_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_events"
  ADD CONSTRAINT "agent_events_target_conversation_agent_id_fkey"
  FOREIGN KEY ("target_conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_event_deliveries"
  ADD CONSTRAINT "agent_event_deliveries_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "agent_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_event_deliveries"
  ADD CONSTRAINT "agent_event_deliveries_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_event_deliveries"
  ADD CONSTRAINT "agent_event_deliveries_conversation_agent_id_fkey"
  FOREIGN KEY ("conversation_agent_id") REFERENCES "conversation_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
