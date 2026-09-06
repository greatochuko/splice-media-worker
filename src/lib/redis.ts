import Redis from "ioredis";
import { env } from "../config/env";

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  // Automatically reconnect on connection loss
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});
