import { logger } from "../utils/logger";
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
  timeout: 10 * 60 * 1000,
  maxRetries: 3,
});

export type CaptionStyle =
  | "classic"
  | "hormozi"
  | "minimal"
  | "bold"
  | "podcast";

export type TranscribedWord = {
  start: number;
  end: number;
  word: string;
};

export type TranscribedSegment = {
  start: number;
  end: number;
  text: string;
  words: TranscribedWord[];
};

export type TranscribedMedia = {
  fullText: string;
  segments: TranscribedSegment[];
  words: TranscribedWord[];
};

export interface RawClipAsset {
  title: string;
  draftText: string;
  startTime: number;
  endTime: number;
}

const AssetSchema = z.object({
  title: z.string(),
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
  private async extractAudio(localVideoPath: string): Promise<string> {
    const audioPath = path.join(
      os.tmpdir(),
      `audio-${Date.now()}-${Math.random().toString(36).substring(7)}.mp3`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(localVideoPath)
        .noVideo()
        .audioCodec("libmp3lame")
        .audioBitrate("64k")
        .audioChannels(1)
        .output(audioPath)
        .on("end", () => resolve(audioPath))
        .on("error", reject)
        .run();
    });
  }

  private async getAudioDuration(audioPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        const duration = metadata.format.duration;
        if (!duration) {
          reject(new Error("Could not determine audio duration"));
          return;
        }
        resolve(duration);
      });
    });
  }

  private async splitAudio(
    audioPath: string,
    duration: number,
  ): Promise<string[]> {
    const CHUNK_DURATION = 10 * 60; // 10 minutes
    const chunks: string[] = [];

    for (let startTime = 0; startTime < duration; startTime += CHUNK_DURATION) {
      const chunkPath = path.join(
        os.tmpdir(),
        `audio-chunk-${Date.now()}-${Math.random()
          .toString(36)
          .substring(7)}.mp3`,
      );

      const chunkDuration = Math.min(CHUNK_DURATION, duration - startTime);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(audioPath)
          .setStartTime(startTime)
          .setDuration(chunkDuration)
          .audioCodec("libmp3lame")
          .audioBitrate("64k")
          .audioChannels(1)
          .output(chunkPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });

      chunks.push(chunkPath);
    }

    return chunks;
  }

  private async transcribeAudioFile(
    audioPath: string,
    offsetSeconds = 0,
  ): Promise<{
    text: string;
    segments: TranscribedSegment[];
    words: TranscribedWord[];
  }> {
    const audioBuffer = await fs.promises.readFile(audioPath);
    const file = await toFile(audioBuffer, path.basename(audioPath));

    const response = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    });

    const segments: TranscribedSegment[] = (response.segments || []).map(
      (segment) => ({
        start: segment.start + offsetSeconds,
        end: segment.end + offsetSeconds,
        text: segment.text,
        words: [],
      }),
    );

    const words: TranscribedWord[] = (response.words || []).map((word) => ({
      start: word.start + offsetSeconds,
      end: word.end + offsetSeconds,
      word: word.word,
    }));

    return {
      text: response.text,
      segments,
      words,
    };
  }

  public async transcribeMedia(localPath: string): Promise<TranscribedMedia> {
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at path: ${localPath}`);
    }

    const audioPath = await this.extractAudio(localPath);
    let chunkPaths: string[] = [];

    try {
      const duration = await this.getAudioDuration(audioPath);
      logger.info(
        `Audio extracted successfully. Duration: ${Math.round(duration)}s`,
      );

      chunkPaths = await this.splitAudio(audioPath, duration);

      const allSegments: TranscribedSegment[] = [];
      const allWords: TranscribedWord[] = [];
      const allText: string[] = [];

      for (let i = 0; i < chunkPaths.length; i++) {
        const chunkPath = chunkPaths[i];
        if (!chunkPath) continue;

        const offset = i * 10 * 60;
        logger.info(
          `[Transcription ${i + 1}/${chunkPaths.length}] Transcribing chunk...`,
        );

        const result = await this.transcribeAudioFile(chunkPath, offset);

        allText.push(result.text);
        allSegments.push(...result.segments);
        allWords.push(...result.words);

        await fs.promises.unlink(chunkPath).catch(() => {});
      }

      return {
        fullText: allText.join(" "),
        segments: allSegments,
        words: allWords,
      };
    } finally {
      await fs.promises.unlink(audioPath).catch(() => {});
      for (const chunkPath of chunkPaths) {
        await fs.promises.unlink(chunkPath).catch(() => {});
      }
    }
  }

  private validateClipTimestamps(
    assets: Array<{
      title: string;
      draftText: string;
      startTime: number | null;
      endTime: number | null;
    }>,
    duration: number,
  ): RawClipAsset[] {
    const validAssets: RawClipAsset[] = [];
    const MAX_CLIP_DURATION = 90; // Increased duration ceiling to allow complete ideas (up to 90s)

    for (const asset of assets) {
      if (asset.startTime === null || asset.endTime === null) continue;
      if (asset.startTime < 0) continue;
      if (asset.endTime <= asset.startTime) continue;
      if (asset.endTime > duration) continue;
      if (asset.endTime - asset.startTime > MAX_CLIP_DURATION) continue;

      validAssets.push({
        title: asset.title,
        draftText: asset.draftText,
        // Apply +/- 0.2s padding for boundary clipping
        startTime: Math.max(0, asset.startTime - 0.2),
        endTime: Math.min(duration, asset.endTime + 0.2),
      });
    }

    return validAssets;
  }

  private async extractAndFormatAssets(
    transcript: TranscribedMedia,
    duration: number,
  ): Promise<RawClipAsset[]> {
    const prompt = `
You are an expert short-form video content strategist.

Analyze the transcript below and identify the strongest moments that can be turned into engaging short-form video clips.

### Instructions:
1. Identify the most captivating, complete, and high-value moments.
2. Ensure each clip represents a COMPLETE thought, argument, or story point. Clips should generally be between 30 and 75 seconds long.
3. Every clip MUST NOT exceed 90 seconds in duration.
4. Provide explicit \`startTime\` and \`endTime\` timestamps in seconds for every video clip.
5. Do not start or end mid-sentence. Include full setups, hooks, and conclusions.
6. Write a natural, platform-agnostic caption/description for each clip in \`draftText\` — the person will tailor it further per platform afterward.

### Transcript Data:
${JSON.stringify(transcript.segments, null, 2)}
`;

    const response = await openai.chat.completions.parse({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are an expert short-form video editor. Extract complete, impactful moments from transcripts and return precise timestamps.",
        },
        { role: "user", content: prompt },
      ],
      response_format: zodResponseFormat(
        SocialMediaAssetsSchema,
        "social_media_assets",
      ),
    });

    const rawAssets = response.choices[0]?.message.parsed?.assets ?? [];
    return this.validateClipTimestamps(rawAssets, duration);
  }

  private async downloadToTempFile(url: string): Promise<string> {
    const urlPath = url.split("?")[0];
    const ext = path.extname(urlPath || "") || ".mp4";
    const tempPath = path.join(os.tmpdir(), `splice-media-${Date.now()}${ext}`);
    const writer = fs.createWriteStream(tempPath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      timeout: 10 * 60 * 1000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
        if (!error) resolve(tempPath);
      });
    });
  }

  private formatAssTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);

    return `${String(h).padStart(1, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  public async generateProfessionalAssSubtitleFile(
    words: TranscribedWord[],
    startTime: number,
    endTime: number,
    style: CaptionStyle = "hormozi",
  ): Promise<string> {
    const assPath = path.join(
      os.tmpdir(),
      `captions-${Date.now()}-${Math.random().toString(36).substring(7)}.ass`,
    );

    const clipWords = words.filter(
      (word) => word.end > startTime && word.start < endTime,
    );

    const STYLES_CONFIG = {
      hormozi: {
        fontSize: 72,
        primaryColor: "&H00FFFFFF",
        outline: 4,
        shadow: 2,
      },
      bold: { fontSize: 80, primaryColor: "&H00FFFFFF", outline: 5, shadow: 2 },
      minimal: {
        fontSize: 60,
        primaryColor: "&H00FFFFFF",
        outline: 2,
        shadow: 1,
      },
      classic: {
        fontSize: 65,
        primaryColor: "&H00FFFFFF",
        outline: 3,
        shadow: 0,
      },
      podcast: {
        fontSize: 70,
        primaryColor: "&H00FFFFFF",
        outline: 3,
        shadow: 2,
      },
    };

    const config = STYLES_CONFIG[style] || STYLES_CONFIG.hormozi;

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${config.fontSize},${config.primaryColor},&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${config.outline},${config.shadow},2,60,60,450,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const groups: TranscribedWord[][] = [];
    let currentGroup: TranscribedWord[] = [];

    for (const word of clipWords) {
      currentGroup.push(word);
      if (currentGroup.length >= 5 || word.word.match(/[.!?,]$/)) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    const dialogueLines = groups.map((group) => {
      const first = group[0];
      const last = group[group.length - 1];
      if (!first || !last) return "";

      const relativeStart = Math.max(0, first.start - startTime);
      const relativeEnd = Math.min(endTime - startTime, last.end - startTime);

      const startFormatted = this.formatAssTime(relativeStart);
      const endFormatted = this.formatAssTime(relativeEnd);

      const text = group
        .map((word) => {
          const duration = Math.max(
            1,
            Math.round(((word.end - word.start) * 100) / 10),
          );
          const cleanWord = word.word.trim().replace(/[{}]/g, "");
          return `{\\k${duration}}${cleanWord}`;
        })
        .join(" ");

      return `Dialogue: 0,${startFormatted},${endFormatted},Default,,0,0,0,,${text}`;
    });

    await fs.promises.writeFile(
      assPath,
      header + dialogueLines.join("\n"),
      "utf8",
    );
    return assPath;
  }

  public async generateClipMetadata(
    filePathOrUrl: string,
  ): Promise<{ transcript: TranscribedMedia; assets: RawClipAsset[] }> {
    let localSourcePath = filePathOrUrl;
    let isTempSource = false;

    try {
      if (
        filePathOrUrl.startsWith("http://") ||
        filePathOrUrl.startsWith("https://")
      ) {
        localSourcePath = await this.downloadToTempFile(filePathOrUrl);
        isTempSource = true;
      }

      const duration = await this.getAudioDuration(
        await this.extractAudio(localSourcePath),
      );
      const transcriptData = await this.transcribeMedia(localSourcePath);
      const rawAssets = await this.extractAndFormatAssets(
        transcriptData,
        duration,
      );

      return {
        transcript: transcriptData,
        assets: rawAssets,
      };
    } finally {
      if (isTempSource && fs.existsSync(localSourcePath)) {
        await fs.promises.unlink(localSourcePath).catch(() => {});
      }
    }
  }
}

export const aiService = new AiService();
