-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('SERVICE', 'HMS');

-- CreateEnum
CREATE TYPE "HmsFormType" AS ENUM ('GENERAL', 'SJA', 'HOT_WORK', 'INTERNAL_CONTROL', 'DEVIATION', 'SAFETY_ROUND', 'WRITTEN_INSTRUCTION');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "hmsType" "HmsFormType",
ADD COLUMN     "templateCategory" "TemplateCategory" NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE "ReportRevision" ADD COLUMN     "hmsType" "HmsFormType",
ADD COLUMN     "templateCategory" "TemplateCategory" NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "category" "TemplateCategory" NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "hmsType" "HmsFormType";

-- CreateIndex
CREATE INDEX "Template_category_hmsType_idx" ON "Template"("category", "hmsType");

