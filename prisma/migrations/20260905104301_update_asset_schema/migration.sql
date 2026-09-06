/*
  Warnings:

  - Added the required column `mediaType` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `mediaUrl` to the `Asset` table without a default value. This is not possible if the table is not empty.
  - Added the required column `thumbnailUrl` to the `Asset` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "endTime" DOUBLE PRECISION,
ADD COLUMN     "mediaType" TEXT NOT NULL,
ADD COLUMN     "mediaUrl" TEXT NOT NULL,
ADD COLUMN     "startTime" DOUBLE PRECISION,
ADD COLUMN     "thumbnailUrl" TEXT NOT NULL;
