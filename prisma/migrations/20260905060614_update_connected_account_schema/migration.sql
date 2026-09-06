/*
  Warnings:

  - You are about to drop the column `expiresAt` on the `ConnectedAccount` table. All the data in the column will be lost.
  - Added the required column `accessTokenExpiresAt` to the `ConnectedAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `scope` to the `ConnectedAccount` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ConnectedAccount" DROP COLUMN "expiresAt",
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT NOT NULL;
