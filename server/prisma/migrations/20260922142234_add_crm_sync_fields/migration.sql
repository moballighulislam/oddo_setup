-- AlterTable
ALTER TABLE "leads" ADD COLUMN "crm_lead_id" INTEGER;
ALTER TABLE "leads" ADD COLUMN "crm_synced_at" DATETIME;

-- CreateIndex
CREATE INDEX "leads_crm_lead_id_idx" ON "leads"("crm_lead_id");
