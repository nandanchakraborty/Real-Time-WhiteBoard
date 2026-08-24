-- Restore share tokens that are required by the Board model and API.
ALTER TABLE "boards"
ADD COLUMN IF NOT EXISTS "edit_token" TEXT,
ADD COLUMN IF NOT EXISTS "view_token" TEXT;

UPDATE "boards"
SET
    "edit_token" = md5(random()::text || clock_timestamp()::text || "id"),
    "view_token" = md5(random()::text || clock_timestamp()::text || "id" || 'view')
WHERE "edit_token" IS NULL OR "view_token" IS NULL;

ALTER TABLE "boards"
ALTER COLUMN "edit_token" SET NOT NULL,
ALTER COLUMN "view_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "boards_edit_token_key" ON "boards"("edit_token");
CREATE UNIQUE INDEX IF NOT EXISTS "boards_view_token_key" ON "boards"("view_token");