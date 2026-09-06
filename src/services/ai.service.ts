import { Platform } from "../generated/prisma/enums";
import { logger } from "../utils/logger";
import { storageService } from "./storage.service";
import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import OpenAI, { toFile } from "openai";
import { env } from "../config/env";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import ffmpeg from "fluent-ffmpeg";

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: 10 * 60 * 1000, // 10 minute timeout for media transcription uploads
  maxRetries: 3,
});

export interface GeneratedAsset {
  title: string;
  platform: Platform;
  draftText: string;
  startTime?: number | null;
  endTime?: number | null;
  mediaUrl: string;
  thumbnailUrl: string;
  mediaType: string;
}

type TranscribedMedia = {
  fullText: string;
  segments: Array<{ start: number; end: number; text: string }>;
};

const AssetSchema = z.object({
  title: z.string(),
  platform: z.enum(Platform),
  draftText: z.string(),
  startTime: z
    .number()
    .nullable()
    .describe("Start timestamp in seconds for video clip (or null if N/A)"),
  endTime: z
    .number()
    .nullable()
    .describe("End timestamp in seconds for video clip (or null if N/A)"),
});

const SocialMediaAssetsSchema = z.object({
  assets: z.array(AssetSchema),
});

export class AiService {
  /**
   * Helper: Convert time in seconds to ASS subtitle timestamp format (H:MM:SS.cs)
   */
  private formatAssTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);

    const hh = String(h).padStart(1, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    const cscs = String(cs).padStart(2, "0");

    return `${hh}:${mm}:${ss}.${cscs}`;
  }

  /**
   * Helper: Generate temporary .ass subtitle file for a specific clip timeframe
   */
  private async generateAssSubtitleFile(
    segments: Array<{ start: number; end: number; text: string }>,
    startTime: number,
    endTime: number,
  ): Promise<string> {
    const assPath = path.join(
      os.tmpdir(),
      `subtitles-${Date.now()}-${Math.random().toString(36).substring(7)}.ass`,
    );

    // Filter segments that fall into the clip window and adjust timestamps relative to clip start
    const clipSegments = segments.filter(
      (seg) => seg.end > startTime && seg.start < endTime,
    );

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,65,&H00FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,10,10,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogueLines = clipSegments.map((seg) => {
      // Relative start/end relative to 00:00:00 of clip video
      const relStart = Math.max(0, seg.start - startTime);
      const relEnd = Math.min(endTime - startTime, seg.end - startTime);

      const startFormatted = this.formatAssTime(relStart);
      const endFormatted = this.formatAssTime(relEnd);
      const cleanText = seg.text.trim().replace(/\n/g, " ");

      return `Dialogue: 0,${startFormatted},${endFormatted},Default,,0,0,0,,${cleanText}`;
    });

    const content = header + dialogueLines.join("\n");
    await fs.promises.writeFile(assPath, content, "utf-8");

    return assPath;
  }

  private async transcribeMedia(localPath: string): Promise<TranscribedMedia> {
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at path: ${localPath}`);
    }

    const fileBuffer = await fs.promises.readFile(localPath);
    const filename = path.basename(localPath);
    const file = await toFile(fileBuffer, filename);

    const response = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const segments = (response.segments || []).map((seg) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text,
    }));

    return {
      fullText: response.text,
      segments,
    };
  }

  private async extractAndFormatAssets(
    transcript: {
      fullText: string;
      segments: Array<{ start: number; end: number; text: string }>;
    },
    platforms: Platform[],
  ) {
    const prompt = `
You are an expert short-form video content strategist.

Analyze the transcript below and identify the strongest moments that can be turned into engaging short-form video clips for: ${platforms.join(
      ", ",
    )}.

### Instructions:
1. Identify the most captivating, insightful, surprising, emotional, controversial, or valuable moments that would work well as short-form videos.
2. Every video clip MUST be 35 seconds or less.
3. Prefer clips that are naturally self-contained and make sense without requiring the viewer to watch the rest of the original video.
4. Prioritize strong hooks, clear takeaways, interesting statements, and moments likely to retain viewer attention.
5. Provide explicit \`startTime\` and \`endTime\` timestamps in seconds for every video clip.
6. The difference between \`endTime\` and \`startTime\` MUST NEVER exceed 35 seconds.
7. Do not create clips that start or end in the middle of a sentence unless absolutely necessary. Choose timestamp boundaries that preserve the natural flow of the speaker.
8. Avoid overlapping clips unless they represent clearly different valuable moments.
9. For platforms that support short-form video (TikTok, Instagram, YouTube Shorts), create video clips only.
10. Do not create text posts, newsletters, or long-form content. These assets are strictly for short-form video clips.

### Transcript Data:
${JSON.stringify(transcript.segments, null, 2)}
`;

    const response = await openai.chat.completions.parse({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an expert short-form video editor. Extract the strongest moments from transcripts and return precise timestamps for engaging short-form clips. Every clip must be 35 seconds or shorter.",
        },
        { role: "user", content: prompt },
      ],
      response_format: zodResponseFormat(
        SocialMediaAssetsSchema,
        "social_media_assets",
      ),
    });

    return response.choices[0]?.message.parsed?.assets ?? [];
  }

  /**
   * Helper: Stream remote URL directly to temp disk path without loading into RAM
   */
  private async downloadToTempFile(url: string): Promise<string> {
    const urlPath = url.split("?")[0];
    const ext = path.extname(urlPath || "") || ".mp4";
    const tempPath = path.join(os.tmpdir(), `splice-media-${Date.now()}${ext}`);

    const writer = fs.createWriteStream(tempPath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream", // Stream directly to disk instead of arraybuffer in RAM
      timeout: 10 * 60 * 1000, // 10 minute timeout
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
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
        if (!error) {
          resolve(tempPath);
        }
      });
    });
  }

  /**
   * Helper: Render physical 9:16 vertical video with burned-in subtitles using FFmpeg
   */
  private async renderClipWithFFmpeg(
    inputPath: string,
    startTime: number,
    endTime: number,
    subtitlesPath?: string,
  ): Promise<string> {
    const duration = endTime - startTime;
    const outputPath = path.join(
      os.tmpdir(),
      `clip-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`,
    );

    // Build filter stack
    const filters: string[] = ["crop=ih*(9/16):ih", "scale=1080:1920"];

    if (subtitlesPath) {
      // Escape string safely for FFmpeg filter parser
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

  /**
   * Helper: Generate dynamic Cloudinary thumbnail JPG URL from a video URL
   */
  private generateCloudinaryThumbnailUrl(cloudinaryVideoUrl: string): string {
    if (!cloudinaryVideoUrl.includes("cloudinary.com")) return "";
    return cloudinaryVideoUrl
      .replace(/\/video\/upload\//, "/video/upload/so_0,f_jpg,q_auto/")
      .replace(/\.[^/.]+$/, ".jpg");
  }

  /**
   * Core Pipeline: Download -> Transcribe -> Pick Moments -> Render Video -> Cloudinary Storage
   */
  async generateClips(
    filePathOrUrl: string,
    platforms: Platform[],
  ): Promise<GeneratedAsset[]> {
    let localSourcePath = filePathOrUrl;
    let isTempSource = false;

    logger.info(
      `Starting clip generation pipeline for input: ${filePathOrUrl}`,
    );

    try {
      // 1. Download to local temp disk ONLY so local tools (Whisper & FFmpeg) can read it
      if (
        filePathOrUrl.startsWith("http://") ||
        filePathOrUrl.startsWith("https://")
      ) {
        logger.info(
          `[Step 1/3] Streaming remote source to temp disk: ${filePathOrUrl}`,
        );
        localSourcePath = await this.downloadToTempFile(filePathOrUrl);
        isTempSource = true;
      }

      // 2. Transcribe audio with local Whisper
      logger.info(`[Step 2/3] Transcribing media with Whisper...`);
      const transcriptData = await this.transcribeMedia(localSourcePath);

      // 3. Pick viral timestamps with GPT-4o
      logger.info(`[Step 3/3] Extracting hooks with GPT-4o...`);
      const rawAssets = await this.extractAndFormatAssets(
        transcriptData,
        platforms,
      );

      const finalizedAssets: GeneratedAsset[] = [];

      // 4. Render FFmpeg vertical clips and upload ONLY the rendered clips
      for (let i = 0; i < rawAssets.length; i++) {
        const asset = rawAssets[i];
        if (!asset) continue;

        let mediaUrl = filePathOrUrl;
        let thumbnailUrl = "";
        const mediaType = "video/mp4";

        if (
          asset.startTime !== null &&
          asset.endTime !== null &&
          asset.endTime > asset.startTime
        ) {
          logger.info(
            `[Asset ${i + 1}/${rawAssets.length}] Rendering vertical clip (${asset.startTime}s to ${asset.endTime}s)...`,
          );

          // 1. Generate local ASS subtitles file for this specific clip segment
          const subtitlePath = await this.generateAssSubtitleFile(
            transcriptData.segments,
            asset.startTime,
            asset.endTime,
          );

          try {
            // 2. Render local 9:16 clip WITH subtitles filter
            const renderedClipPath = await this.renderClipWithFFmpeg(
              localSourcePath,
              asset.startTime,
              asset.endTime,
              subtitlePath,
            );

            // 3. Upload rendered video
            mediaUrl = await storageService.uploadFile(renderedClipPath);
            thumbnailUrl = this.generateCloudinaryThumbnailUrl(mediaUrl);

            // Clean up temp render output
            await fs.promises.unlink(renderedClipPath).catch(() => {});
          } finally {
            // Clean up temp subtitle file
            await fs.promises.unlink(subtitlePath).catch(() => {});
          }
        } else {
          thumbnailUrl = this.generateCloudinaryThumbnailUrl(filePathOrUrl);
        }

        finalizedAssets.push({
          title: asset.title,
          platform: asset.platform,
          draftText: asset.draftText,
          startTime: asset.startTime,
          endTime: asset.endTime,
          mediaUrl,
          thumbnailUrl,
          mediaType,
        });
      }

      return finalizedAssets;
    } catch (error) {
      logger.error("Error in AI processing pipeline:", error);
      throw error;
    } finally {
      // Clean up the temporary downloaded source video
      if (isTempSource && fs.existsSync(localSourcePath)) {
        await fs.promises.unlink(localSourcePath).catch(() => {});
      }
    }
  }
}

export const aiService = new AiService();
