/*
  Warnings:

  - Made the column `handle` on table `ConnectedAccount` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ConnectedAccount" ALTER COLUMN "handle" SET NOT NULL;
