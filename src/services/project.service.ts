import { Platform } from "../generated/prisma/enums";
import { AssetCreateManyInput } from "../generated/prisma/models";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { aiService } from "./ai.service";
import { storageService } from "./storage.service";

export interface Job<T = unknown> {
  id?: string;
  data: T;
}

export class ProjectService {
  // Executed asynchronously in worker process / queue runner
  async processProjectMediaJob(
    job: Job<{
      projectId: string;
      sourceUrl?: string;
      sourceFile?: string;
      targetPlatforms: Platform[];
    }>,
  ) {
    const { projectId, sourceUrl, sourceFile, targetPlatforms } = job.data;

    try {
      let masterMediaUrl = sourceFile || sourceUrl;

      if (!masterMediaUrl) {
        throw new Error("No source media found to process");
      }

      // Step A: Update status to PROCESSING
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "PROCESSING" },
      });

      // Step B: Ensure the master source media is persisted in Cloudinary once
      // (If it came in as a raw external URL, persist it before running clip generation)
      if (sourceUrl && !sourceFile && !sourceUrl.includes("cloudinary.com")) {
        masterMediaUrl = await storageService.uploadFile(sourceUrl);

        await prisma.project.update({
          where: { id: projectId },
          data: { sourceFile: masterMediaUrl },
        });
      }

      // Step C: Generate clips via AI & FFmpeg (Uploads ONLY newly rendered vertical clips)
      const generatedAssets = await aiService.generateClips(
        masterMediaUrl,
        targetPlatforms,
      );

      // Step D: Save created assets & set Project status to READY
      await prisma.$transaction([
        prisma.asset.createMany({
          data: generatedAssets.map(
            (clip): AssetCreateManyInput => ({
              projectId,
              title: clip.title,
              platform: clip.platform,
              draftText: clip.draftText,
              startTime: clip.startTime ?? null,
              endTime: clip.endTime ?? null,
              mediaUrl: clip.mediaUrl,
              thumbnailUrl: clip.thumbnailUrl,
              mediaType: clip.mediaType,
              status: "draft",
            }),
          ),
        }),
        prisma.project.update({
          where: { id: projectId },
          data: {
            sourceFile: masterMediaUrl,
            status: "READY",
          },
        }),
      ]);
    } catch (error) {
      const errorMessage =
        (error as Error).message || "Unknown processing error occurred";

      logger.error(`Project job failed for ${projectId}:`, errorMessage);

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "FAILED", errorMessage },
      });
    }
  }
}

export const projectService = new ProjectService();
