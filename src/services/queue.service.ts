import { Queue } from "bullmq";
import { logger } from "../utils/logger";
import { redisClient } from "../lib/redis";
import { Platform } from "../generated/prisma/enums";
import { TranscribedWord } from "./ai.service";

redisClient.on("error", (err) => {
  logger.warn("Redis connection error:", err.message);
});

export interface MediaJobPayload {
  projectId: string;
  sourceUrl?: string;
  sourceFile?: string;
  targetPlatforms: Platform[];
}

export interface RenderJobPayload {
  projectId: string;
  assetId: string;
  sourceUrl: string;
  startTime: number;
  endTime: number;
  words: TranscribedWord[];
}

export class QueueService {
  public mediaQueue: Queue<MediaJobPayload>;
  public renderQueue: Queue<RenderJobPayload>;

  constructor() {
    this.mediaQueue = new Queue<MediaJobPayload>("media-processing", {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    this.renderQueue = new Queue<RenderJobPayload>("video-rendering", {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }

  async addMediaJob(data: MediaJobPayload): Promise<unknown> {
    return await this.mediaQueue.add("process-media", data);
  }

  async addRenderJob(data: RenderJobPayload): Promise<unknown> {
    return await this.renderQueue.add("render-clip", data);
  }
}

export const queueService = new QueueService();
