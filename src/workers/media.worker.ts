import { Worker, Job } from "bullmq";
import { logger } from "../utils/logger";
import { projectService } from "../services/project.service";
import { Platform } from "../generated/prisma/enums";
import { redisClient } from "../lib/redis";

// Standard payload interface matching what you pass in createProject
interface MediaJobData {
  projectId: string;
  sourceUrl?: string;
  sourceFile?: string;
  targetPlatforms: Platform[];
}

export const mediaWorker = new Worker<MediaJobData>(
  "media-processing", // MUST match the default queueName in QueueService constructor
  async (job: Job<MediaJobData>) => {
    logger.info(
      `[Worker] Starting job ${job.id} for project ${job.data.projectId}`,
    );

    // Call your project service method directly
    await projectService.processProjectMediaJob(job);
  },
  {
    connection: redisClient,
    concurrency: 2, // Controls how many videos process concurrently
  },
);

mediaWorker.on("completed", (job) => {
  logger.info(`[Worker] Job ${job.id} completed successfully.`);
});

mediaWorker.on("failed", (job, err) => {
  logger.error(`[Worker] Job ${job?.id} failed with error: ${err.message}`);
});
