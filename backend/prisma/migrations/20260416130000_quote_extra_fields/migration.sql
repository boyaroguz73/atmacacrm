-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "agentInfo" TEXT,
ADD COLUMN     "colorFabricInfo" TEXT,
ADD COLUMN     "measurementInfo" TEXT,
ADD COLUMN     "grandTotalOverride" DOUBLE PRECISION;
