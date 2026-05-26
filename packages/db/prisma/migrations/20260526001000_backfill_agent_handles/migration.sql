WITH prepared AS (
  SELECT
    "id",
    COALESCE(
      NULLIF(
        trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9_-]+', '-', 'g')),
        ''
      ),
      'agent'
    ) AS "base_handle"
  FROM "agents"
  WHERE "handle" ~ '^agent-[0-9a-f]{8}$'
),
ranked AS (
  SELECT
    "id",
    "base_handle",
    row_number() OVER (PARTITION BY "base_handle" ORDER BY "id") AS "rank"
  FROM prepared
),
resolved AS (
  SELECT
    "id",
    CASE
      WHEN "rank" = 1 THEN left("base_handle", 64)
      ELSE left("base_handle", 55) || '-' || "rank"::text
    END AS "next_handle"
  FROM ranked
)
UPDATE "agents"
SET "handle" = resolved."next_handle"
FROM resolved
WHERE "agents"."id" = resolved."id"
  AND NOT EXISTS (
    SELECT 1
    FROM "agents" existing
    WHERE existing."handle" = resolved."next_handle"
      AND existing."id" <> resolved."id"
  );
