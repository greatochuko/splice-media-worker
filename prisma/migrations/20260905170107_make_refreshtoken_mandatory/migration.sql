/*
  Warnings:

  - Made the column `refreshToken` on table `ConnectedAccount` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ConnectedAccount" ALTER COLUMN "refreshToken" SET NOT NULL;
