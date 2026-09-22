-- AlterTable
ALTER TABLE "automation_events" ADD COLUMN "submission_id" INTEGER;

-- CreateIndex
CREATE INDEX "automation_events_submission_id_event_type_idx" ON "automation_events"("submission_id", "event_type");
