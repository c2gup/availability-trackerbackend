-- CreateEnum
CREATE TYPE "WeekFillStatus" AS ENUM ('MATERIALIZED', 'CLEARED', 'MANUAL');

-- CreateTable
CREATE TABLE "availability_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "mentor_id" TEXT,
    "role" "Role" NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_week_meta" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "mentor_id" TEXT,
    "role" "Role" NOT NULL,
    "week_start" DATE NOT NULL,
    "status" "WeekFillStatus" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_week_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "availability_templates_user_dow_hour_key" ON "availability_templates"("user_id", "day_of_week", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "availability_templates_mentor_dow_hour_key" ON "availability_templates"("mentor_id", "day_of_week", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "availability_week_meta_user_week_key" ON "availability_week_meta"("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "availability_week_meta_mentor_week_key" ON "availability_week_meta"("mentor_id", "week_start");

-- AddForeignKey
ALTER TABLE "availability_templates" ADD CONSTRAINT "availability_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_templates" ADD CONSTRAINT "availability_templates_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_week_meta" ADD CONSTRAINT "availability_week_meta_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_week_meta" ADD CONSTRAINT "availability_week_meta_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
