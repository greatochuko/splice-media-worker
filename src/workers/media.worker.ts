import { Worker, Job } from "bullmq";
import { logger } from "../utils/logger";
import { projectService } from "../services/project.service";
import { redisClient } from "../lib/redis";
import { MediaJobPayload } from "../services/queue.service";

export const mediaWorker = new Worker<MediaJobPayload>(
  "media-processing",
  async (job: Job<MediaJobPayload>) => {
    logger.info(
      `[Media Worker] Starting job ${job.id} for project ${job.data.projectId}`,
    );
    await projectService.processProjectMediaJob(job);
  },
  {
    connection: redisClient,
    concurrency: 2,
  },
);

mediaWorker.on("completed", (job) => {
  logger.info(`[Media Worker] Job ${job.id} completed successfully.`);
});

mediaWorker.on("failed", (job, err) => {
  logger.error(
    `[Media Worker] Job ${job?.id} failed with error: ${err.message}`,
  );
});
