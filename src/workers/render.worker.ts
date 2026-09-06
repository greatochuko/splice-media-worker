import { Worker, Job } from "bullmq";
import { logger } from "../utils/logger";
import { redisClient } from "../lib/redis";
import { videoRenderService } from "../services/video-render.service";
import { RenderJobPayload } from "../services/queue.service";

export const renderWorker = new Worker<RenderJobPayload>(
  "video-rendering",
  async (job: Job<RenderJobPayload>) => {
    logger.info(
      `[Render Worker] Rendering asset ${job.data.assetId} for project ${job.data.projectId}`,
    );
    await videoRenderService.render(job.data);
  },
  {
    connection: redisClient,
    concurrency: 1, // Keep concurrency at 1 on CPU-bound servers
  },
);

renderWorker.on("completed", (job) => {
  logger.info(`[Render Worker] Job ${job.id} completed.`);
});

renderWorker.on("failed", (job, error) => {
  logger.error(
    `[Render Worker] Job ${job?.id} failed with error: ${error.message}`,
  );
});
