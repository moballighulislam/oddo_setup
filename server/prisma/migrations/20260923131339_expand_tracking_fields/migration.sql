-- AlterTable
ALTER TABLE "tracking_data" ADD COLUMN "browser_language" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "browser_timezone" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "days_since_first_visit" INTEGER;
ALTER TABLE "tracking_data" ADD COLUMN "fbclid" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "gclid" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "geo_is_hosting" BOOLEAN;
ALTER TABLE "tracking_data" ADD COLUMN "geo_isp" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "geo_latitude" REAL;
ALTER TABLE "tracking_data" ADD COLUMN "geo_longitude" REAL;
ALTER TABLE "tracking_data" ADD COLUMN "geo_organisation" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "geo_postal_code" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "geo_timezone" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "li_fat_id" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "msclkid" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "page_journey" TEXT;
ALTER TABLE "tracking_data" ADD COLUMN "scroll_depth" INTEGER;
