/*
  Warnings:

  - You are about to drop the column `refreshToken` on the `ConnectedAccount` table. All the data in the column will be lost.
  - Made the column `accessToken` on table `ConnectedAccount` required. This step will fail if there are existing NULL values in that column.
  - Made the column `expiresAt` on table `ConnectedAccount` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ConnectedAccount" DROP COLUMN "refreshToken",
ALTER COLUMN "accessToken" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL;
