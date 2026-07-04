-- Option B: old multi-row table HAS data you want to keep
-- Uses a session temp table (not a permanent v2 table)

BEGIN;

CREATE TEMP TABLE "_tpl_migrate" ON COMMIT DROP AS
SELECT
  gen_random_uuid()::text AS id,
  "user_id",
  NULL::text AS mentor_id,
  "role",
  COALESCE(
    jsonb_agg(
      jsonb_build_object('dayOfWeek', "day_of_week", 'hour', "hour")
      ORDER BY "day_of_week", "hour"
    ),
    '[]'::jsonb
  ) AS slots,
  MIN("created_at") AS created_at,
  MAX("updated_at") AS updated_at
FROM "availability_templates"
WHERE "user_id" IS NOT NULL
GROUP BY "user_id", "role"

UNION ALL

SELECT
  gen_random_uuid()::text,
  NULL::text,
  "mentor_id",
  "role",
  COALESCE(
    jsonb_agg(
      jsonb_build_object('dayOfWeek', "day_of_week", 'hour', "hour")
      ORDER BY "day_of_week", "hour"
    ),
    '[]'::jsonb
  ),
  MIN("created_at"),
  MAX("updated_at")
FROM "availability_templates"
WHERE "mentor_id" IS NOT NULL
GROUP BY "mentor_id", "role";

DROP TABLE "availability_templates";

CREATE TABLE "availability_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "mentor_id" TEXT,
    "role" "Role" NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "availability_templates_pkey" PRIMARY KEY ("id")
);

INSERT INTO "availability_templates" ("id", "user_id", "mentor_id", "role", "slots", "created_at", "updated_at")
SELECT id, user_id, mentor_id, role, slots, created_at, updated_at
FROM "_tpl_migrate";

CREATE UNIQUE INDEX "availability_templates_user_id_key"
  ON "availability_templates" ("user_id");

CREATE UNIQUE INDEX "availability_templates_mentor_id_key"
  ON "availability_templates" ("mentor_id");

ALTER TABLE "availability_templates"
  ADD CONSTRAINT "availability_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "availability_templates"
  ADD CONSTRAINT "availability_templates_mentor_id_fkey"
  FOREIGN KEY ("mentor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
