-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('CROSS_POST', 'CREATE_PROJECT');

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "autoGenerateCaptions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoHashtags" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "clipLength" TEXT DEFAULT '30-60',
ADD COLUMN     "targetPlatforms" "Platform"[] DEFAULT ARRAY[]::"Platform"[],
ADD COLUMN     "type" "WorkflowType" NOT NULL DEFAULT 'CROSS_POST',
ALTER COLUMN "autoPublish" SET DEFAULT false;
