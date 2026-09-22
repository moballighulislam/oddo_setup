-- CreateTable
CREATE TABLE "junk_submissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "submission_uuid" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "email" TEXT,
    "contact_name" TEXT,
    "company_name" TEXT,
    "raw_payload" TEXT NOT NULL,
    "bot_reason" TEXT NOT NULL,
    "recaptcha_score" REAL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "geo_country" TEXT,
    "page_url" TEXT,
    "referrer_url" TEXT,
    "promoted_to_lead_id" INTEGER,
    "promoted_at" DATETIME,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "junk_submissions_public_id_key" ON "junk_submissions"("public_id");

-- CreateIndex
CREATE INDEX "junk_submissions_bot_reason_idx" ON "junk_submissions"("bot_reason");

-- CreateIndex
CREATE INDEX "junk_submissions_created_at_idx" ON "junk_submissions"("created_at");

-- CreateIndex
CREATE INDEX "junk_submissions_email_idx" ON "junk_submissions"("email");

-- CreateIndex
CREATE INDEX "junk_submissions_promoted_to_lead_id_idx" ON "junk_submissions"("promoted_to_lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "junk_submissions_submission_uuid_key" ON "junk_submissions"("submission_uuid");
