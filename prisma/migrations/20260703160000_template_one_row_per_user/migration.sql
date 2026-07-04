-- Option A: table is empty OR you don't need existing template rows
-- Run this only:

DROP TABLE IF EXISTS "availability_templates";

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
