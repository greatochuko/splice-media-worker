import { Platform } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { aiService } from "./ai.service";
import { storageService } from "./storage.service";
import { MediaJobPayload, queueService } from "./queue.service";
import { AssetCreateManyInput } from "../generated/prisma/models";

export interface Job<T = unknown> {
  id?: string;
  data: T;
}

export class ProjectService {
  async processProjectMediaJob(job: Job<MediaJobPayload>) {
    const { projectId, sourceUrl, sourceFile } = job.data;

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
        await aiService.generateClipMetadata(masterMediaUrl);

      // 2. Create Asset records with 'processing' status
      // Single bulk INSERT query returning created records with generated IDs
      const createdAssets = await prisma.asset.createManyAndReturn({
        data: generatedAssets.map(
          (clip): AssetCreateManyInput => ({
            projectId,
            title: clip.title,
            draftText: clip.draftText,
            startTime: clip.startTime,
            endTime: clip.endTime,
            mediaUrl: "",
            thumbnailUrl: "",
            mediaType: "video/mp4",
            status: "processing",
          }),
        ),
      });

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
