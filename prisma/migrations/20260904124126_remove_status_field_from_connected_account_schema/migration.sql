/*
  Warnings:

  - You are about to drop the column `status` on the `ConnectedAccount` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ConnectedAccount_status_idx";

-- AlterTable
ALTER TABLE "ConnectedAccount" DROP COLUMN "status";

-- DropEnum
DROP TYPE "AccountStatus";
