import fs from "fs";
import path from "path";
import os from "os";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import { aiService, CaptionStyle, TranscribedWord } from "./ai.service";
import { storageService } from "./storage.service";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export interface RenderClipInput {
  projectId: string;
  assetId: string;
  sourceUrl: string;
  startTime: number;
  endTime: number;
  words: TranscribedWord[];
  captionStyle?: CaptionStyle;
}

export class VideoRenderService {
  private async downloadToTempFile(url: string): Promise<string> {
    const urlPath = url.split("?")[0];
    const ext = path.extname(urlPath || "") || ".mp4";
    const tempPath = path.join(
      os.tmpdir(),
      `render-source-${Date.now()}${ext}`,
    );
    const writer = fs.createWriteStream(tempPath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      timeout: 10 * 60 * 1000,
    });

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let error: Error | null = null;
      writer.on("error", (err) => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on("close", () => {
        if (!error) resolve(tempPath);
      });
    });
  }

  private generateCloudinaryThumbnailUrl(cloudinaryVideoUrl: string): string {
    if (!cloudinaryVideoUrl.includes("cloudinary.com")) return "";
    return cloudinaryVideoUrl
      .replace(/\/video\/upload\//, "/video/upload/so_0,f_jpg,q_auto/")
      .replace(/\.[^/.]+$/, ".jpg");
  }

  private async renderClipWithFFmpeg(
    inputPath: string,
    startTime: number,
    endTime: number,
    subtitlesPath?: string,
  ): Promise<string> {
    const duration = endTime - startTime;
    const outputPath = path.join(
      os.tmpdir(),
      `clip-render-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`,
    );

    const filters: string[] = ["crop=ih*(9/16):ih", "scale=1080:1920"];

    if (subtitlesPath) {
      const escapedSubPath = path
        .resolve(subtitlesPath)
        .replace(/\\/g, "/")
        .replace(":", "\\:");
      filters.push(`ass='${escapedSubPath}'`);
    }

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .videoFilters(filters)
        .outputOptions([
          "-c:v libx264",
          "-crf 23",
          "-preset fast",
          "-c:a aac",
          "-b:a 128k",
        ])
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }

  public async render(data: RenderClipInput): Promise<void> {
    const { assetId, sourceUrl, startTime, endTime, words, captionStyle } =
      data;
    let localSourcePath = sourceUrl;
    let isTempSource = false;
    let subtitlePath: string | null = null;
    let renderedClipPath: string | null = null;

    try {
      if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
        localSourcePath = await this.downloadToTempFile(sourceUrl);
        isTempSource = true;
      }

      subtitlePath = await aiService.generateProfessionalAssSubtitleFile(
        words,
        startTime,
        endTime,
        captionStyle || "hormozi",
      );

      renderedClipPath = await this.renderClipWithFFmpeg(
        localSourcePath,
        startTime,
        endTime,
        subtitlePath,
      );

      const mediaUrl = await storageService.uploadFile(renderedClipPath);
      const thumbnailUrl = this.generateCloudinaryThumbnailUrl(mediaUrl);

      await prisma.asset.update({
        where: { id: assetId },
        data: {
          mediaUrl,
          thumbnailUrl,
          status: "ready",
        },
      });

      // Check if all assets for the project are complete
      const unfinishedAssets = await prisma.asset.count({
        where: {
          projectId: data.projectId,
          status: { in: ["draft", "processing"] },
        },
      });

      if (unfinishedAssets === 0) {
        await prisma.project.update({
          where: { id: data.projectId },
          data: { status: "READY" },
        });
      }
    } catch (error) {
      logger.error(`Failed rendering for asset ${assetId}:`, error);

      await prisma.asset.update({
        where: { id: assetId },
        data: {
          status: "failed",
          renderingError: (error as Error).message || "Rendering failed",
        },
      });

      throw error;
    } finally {
      if (subtitlePath && fs.existsSync(subtitlePath)) {
        await fs.promises.unlink(subtitlePath).catch(() => {});
      }
      if (renderedClipPath && fs.existsSync(renderedClipPath)) {
        await fs.promises.unlink(renderedClipPath).catch(() => {});
      }
      if (isTempSource && fs.existsSync(localSourcePath)) {
        await fs.promises.unlink(localSourcePath).catch(() => {});
      }
    }
  }
}

export const videoRenderService = new VideoRenderService();
