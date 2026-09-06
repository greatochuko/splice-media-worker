-- AlterTable
ALTER TABLE "ConnectedAccount" ADD COLUMN     "tiktokOpenId" TEXT,
ALTER COLUMN "handle" DROP NOT NULL;
