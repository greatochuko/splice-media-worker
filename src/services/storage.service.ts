import { v2 as cloudinary } from "cloudinary";
import { logger } from "../utils/logger";
import { env } from "../config/env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export class StorageService {
  /**
   * Uploads a local file path or remote media URL to Cloudinary using chunked streaming
   */
  async uploadFile(
    sourcePathOrUrl: string,
    folder: string = "project_sources",
  ): Promise<string> {
    try {
      const isLocalFile =
        !sourcePathOrUrl.startsWith("http://") &&
        !sourcePathOrUrl.startsWith("https://");

      // For local files, use upload_large to prevent HTTP 499 timeouts
      if (isLocalFile) {
        return new Promise((resolve, reject) => {
          cloudinary.uploader.upload_large(
            sourcePathOrUrl,
            {
              resource_type: "video",
              folder,
              chunk_size: 6000000, // 6MB chunks
            },
            (error, result) => {
              if (error || !result) {
                return reject(
                  new Error(
                    `Cloudinary chunked upload failed: ${error?.message || "Unknown error"}`,
                  ),
                );
              }
              resolve(result.secure_url);
            },
          );
        });
      }

      // Standard upload for remote URLs
      const result = await cloudinary.uploader.upload(sourcePathOrUrl, {
        resource_type: "video",
        folder,
      });

      return result.secure_url;
    } catch (error) {
      const msg = (error as Error).message || "Cloudinary upload failed";
      logger.error(
        "Cloudinary upload error for source:",
        sourcePathOrUrl,
        error,
      );
      throw new Error(`Failed to upload media to Cloudinary: ${msg}`);
    }
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      const publicId = this.extractPublicId(fileUrl);
      if (publicId) {
        await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
      }
    } catch (error) {
      logger.error("Cloudinary file deletion error:", error);
    }
  }

  private extractPublicId(url: string): string | null {
    try {
      const parts = url.split("/");
      const uploadIndex = parts.indexOf("upload");
      if (uploadIndex === -1) return null;

      const pathParts = parts.slice(uploadIndex + 2);
      const fullPath = pathParts.join("/");
      return fullPath.substring(0, fullPath.lastIndexOf(".")) || fullPath;
    } catch {
      return null;
    }
  }
}

export const storageService = new StorageService();
