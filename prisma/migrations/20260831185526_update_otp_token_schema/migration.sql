/*
  Warnings:

  - You are about to drop the column `userId` on the `OtpToken` table. All the data in the column will be lost.
  - Added the required column `email` to the `OtpToken` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "OtpToken" DROP CONSTRAINT "OtpToken_userId_fkey";

-- DropIndex
DROP INDEX "OtpToken_codeHash_key";

-- DropIndex
DROP INDEX "OtpToken_userId_idx";

-- AlterTable
ALTER TABLE "OtpToken" DROP COLUMN "userId",
ADD COLUMN     "email" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "OtpToken_email_idx" ON "OtpToken"("email");
