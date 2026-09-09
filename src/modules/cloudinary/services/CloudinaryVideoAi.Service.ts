import { v2 as cloudinaryBase, UploadApiResponse } from "cloudinary";
import { cloudinaryVideoAiConfig, assertCloudinaryVideoAiConfig } from "../../../shared/config/cloudinary-video-ai";

export class CloudinaryVideoAiService {
    private get creds() {
        assertCloudinaryVideoAiConfig();
        return cloudinaryVideoAiConfig;
    }

    uploadBuffer(buffer: Buffer, folder: string, publicId?: string): Promise<UploadApiResponse> {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinaryBase.uploader.upload_stream(
                {
                    ...this.creds,
                    folder,
                    public_id: publicId,
                    resource_type: "image",
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result!);
                }
            );

            uploadStream.end(buffer);
        });
    }

    uploadVideoFromUrl(url: string, folder: string, publicId?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cloudinaryBase.uploader.upload(
                url,
                {
                    ...this.creds,
                    folder,
                    public_id: publicId,
                    resource_type: "video",
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result!.secure_url);
                }
            );
        });
    }

    async uploadVideoBuffer(
        buffer: Buffer,
        folder: string,
        publicId: string
    ): Promise<{
        secure_url: string;
        public_id: string;
        duration?: number;
        width?: number;
        height?: number;
        frame_rate?: number;
        thumbnail_url: string;
    }> {
        const creds = this.creds;
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinaryBase.uploader.upload_stream(
                {
                    ...creds,
                    folder,
                    public_id: publicId,
                    resource_type: "video",
                },
                (error, result) => {
                    if (error) return reject(error);

                    const thumbnailUrl = cloudinaryBase.url(result!.public_id, {
                        ...creds,
                        resource_type: "video",
                        format: "jpg",
                        transformation: [{ start_offset: "0" }],
                    });

                    resolve({
                        secure_url: result!.secure_url,
                        public_id: result!.public_id,
                        duration: result!.duration,
                        width: result!.width,
                        height: result!.height,
                        frame_rate: (result as any)!.frame_rate,
                        thumbnail_url: thumbnailUrl,
                    });
                }
            );

            uploadStream.end(buffer);
        });
    }
}