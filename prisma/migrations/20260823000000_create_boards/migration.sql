-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled board',
    "content" JSONB NOT NULL,
    "page_count" INTEGER NOT NULL DEFAULT 1,
    "edit_token" TEXT NOT NULL,
    "view_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boards_user_id_updated_at_idx" ON "boards"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "boards_edit_token_key" ON "boards"("edit_token");

-- CreateIndex
CREATE UNIQUE INDEX "boards_view_token_key" ON "boards"("view_token");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;