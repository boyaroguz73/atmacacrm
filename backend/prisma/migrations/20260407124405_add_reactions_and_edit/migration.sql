-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "isEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reactions" JSONB;
