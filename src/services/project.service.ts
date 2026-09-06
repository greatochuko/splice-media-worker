import { Platform } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { aiService } from "./ai.service";
import { storageService } from "./storage.service";
import { queueService } from "./queue.service";

export interface Job<T = unknown> {
  id?: string;
  data: T;
}

export class ProjectService {
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

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "PROCESSING" },
      });

      if (sourceUrl && !sourceFile && !sourceUrl.includes("cloudinary.com")) {
        masterMediaUrl = await storageService.uploadFile(sourceUrl);
        await prisma.project.update({
          where: { id: projectId },
          data: { sourceFile: masterMediaUrl },
        });
      }

      // 1. Extract metadata and transcript with word timestamps
      const { transcript, assets: generatedAssets } =
        await aiService.generateClipMetadata(masterMediaUrl, targetPlatforms);

      // 2. Create Asset records with 'processing' status
      const createdAssets = await prisma.$transaction(
        generatedAssets.map((clip) =>
          prisma.asset.create({
            data: {
              projectId,
              title: clip.title,
              platform: clip.platform,
              draftText: clip.draftText,
              startTime: clip.startTime,
              endTime: clip.endTime,
              mediaUrl: "",
              thumbnailUrl: "",
              mediaType: "video/mp4",
              status: "processing",
            },
          }),
        ),
      );

      // 3. Queue individual render jobs
      for (const asset of createdAssets) {
        if (asset.startTime === null || asset.endTime === null) continue;

        await queueService.addRenderJob({
          projectId,
          assetId: asset.id,
          sourceUrl: masterMediaUrl,
          startTime: asset.startTime,
          endTime: asset.endTime,
          words: transcript.words,
        });
      }
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
