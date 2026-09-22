-- CreateTable
CREATE TABLE "leads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone_e164" TEXT,
    "company_name" TEXT,
    "job_title" TEXT,
    "company_size" TEXT,
    "framework_interest" TEXT,
    "company_domain" TEXT,
    "company_industry" TEXT,
    "country_code" TEXT,
    "region" TEXT,
    "lead_score" INTEGER NOT NULL DEFAULT 0,
    "lead_status" TEXT NOT NULL DEFAULT 'new',
    "assigned_to" TEXT,
    "routing_tier" TEXT,
    "sla_due_at" DATETIME,
    "first_contacted_at" DATETIME,
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_ip" TEXT,
    "consent_text_version" TEXT,
    "consent_at" DATETIME,
    "first_touch_source" TEXT,
    "last_touch_source" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "submission_uuid" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "inquiry_type" TEXT,
    "message_text" TEXT,
    "raw_payload" TEXT NOT NULL,
    "recaptcha_score" REAL,
    "is_suspected_bot" BOOLEAN NOT NULL DEFAULT false,
    "bot_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tracking_data" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submission_id" INTEGER NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "first_touch_src" TEXT,
    "last_touch_src" TEXT,
    "page_url" TEXT,
    "referrer_url" TEXT,
    "landing_page" TEXT,
    "session_id" TEXT,
    "pages_viewed" INTEGER,
    "visit_count" INTEGER,
    "time_on_site_sec" INTEGER,
    "visited_pricing" BOOLEAN NOT NULL DEFAULT false,
    "device_type" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "geo_country" TEXT,
    "geo_region" TEXT,
    "geo_city" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tracking_data_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lead_id" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "submission_id" INTEGER,
    "awarded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "lead_id" INTEGER,
    "full_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'subscribed',
    "unsubscribe_token" TEXT NOT NULL,
    "email_provider_id" TEXT,
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_ip" TEXT,
    "source_page" TEXT,
    "source_referrer" TEXT,
    "subscribed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "newsletter_subscribers_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "lead_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "job_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT,
    "error_text" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "automation_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_public_id_key" ON "leads"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_email_key" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_lead_score_idx" ON "leads"("lead_score");

-- CreateIndex
CREATE INDEX "leads_lead_status_idx" ON "leads"("lead_status");

-- CreateIndex
CREATE INDEX "leads_assigned_to_idx" ON "leads"("assigned_to");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_public_id_key" ON "form_submissions"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_submissions_submission_uuid_key" ON "form_submissions"("submission_uuid");

-- CreateIndex
CREATE INDEX "form_submissions_lead_id_idx" ON "form_submissions"("lead_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_idx" ON "form_submissions"("form_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_name_idx" ON "form_submissions"("form_name");

-- CreateIndex
CREATE INDEX "form_submissions_created_at_idx" ON "form_submissions"("created_at");

-- CreateIndex
CREATE INDEX "form_submissions_is_suspected_bot_idx" ON "form_submissions"("is_suspected_bot");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_data_submission_id_key" ON "tracking_data"("submission_id");

-- CreateIndex
CREATE INDEX "tracking_data_utm_source_idx" ON "tracking_data"("utm_source");

-- CreateIndex
CREATE INDEX "tracking_data_session_id_idx" ON "tracking_data"("session_id");

-- CreateIndex
CREATE INDEX "tracking_data_landing_page_idx" ON "tracking_data"("landing_page");

-- CreateIndex
CREATE INDEX "lead_scores_lead_id_category_idx" ON "lead_scores"("lead_id", "category");

-- CreateIndex
CREATE INDEX "lead_scores_awarded_at_idx" ON "lead_scores"("awarded_at");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_lead_id_key" ON "newsletter_subscribers"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_unsubscribe_token_key" ON "newsletter_subscribers"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "newsletter_subscribers_status_idx" ON "newsletter_subscribers"("status");

-- CreateIndex
CREATE INDEX "automation_events_lead_id_event_type_idx" ON "automation_events"("lead_id", "event_type");

-- CreateIndex
CREATE INDEX "automation_events_status_idx" ON "automation_events"("status");

-- CreateIndex
CREATE INDEX "automation_events_created_at_idx" ON "automation_events"("created_at");
