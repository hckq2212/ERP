import fs from 'fs';
import cloudinary from '../config/cloudinary';
import { getCloudinaryFolder } from './CloudinaryFolder.Helper';

/**
 * Generate download URL from Cloudinary public_id
 * @param publicId - Cloudinary public ID (e.g., "opportunities/abc123")
 * @param resourceType - Resource type (image, video, raw, auto)
 * @param filename - Optional custom filename for download
 * @returns Download URL with fl_attachment flag
 */
export const generateDownloadUrl = (
    publicId: string,
    resourceType: string = 'auto',
    filename?: string
): string => {
    const options: any = {
        resource_type: resourceType,
        flags: 'attachment',
        secure: true
    };

    // Add custom filename if provided
    if (filename) {
        options.attachment = filename;
    }

    return cloudinary.url(publicId, options);
};

/**
 * Generate download URL with original filename preserved
 */
export const generateDownloadUrlWithFilename = (
    publicId: string,
    originalFilename: string,
    resourceType: string = 'auto'
): string => {
    return cloudinary.url(publicId, {
        resource_type: resourceType,
        flags: `attachment:${originalFilename}`,
        secure: true
    });
};

/**
 * Upload file to Cloudinary with full metadata
 */
export const uploadToCloudinary = (file: Express.Multer.File, folder: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const uploadFolder = getCloudinaryFolder(folder);
        const fileExtension = file.originalname.split('.').pop()?.toLowerCase() || '';
        const fileNameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf('.')) || file.originalname;

        // Remove accents and special characters for a safe public_id
        const safeFileName = fileNameWithoutExt
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, '_');

        const publicIdWithExtension = fileExtension ? `${safeFileName}.${fileExtension}` : safeFileName;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                folder: uploadFolder,
                public_id: publicIdWithExtension,
                use_filename: true,
                unique_filename: true,
                transformation: [
                    { width: 2000, height: 2000, crop: "limit" },
                    { quality: "auto" },
                    { fetch_format: "auto" }
                ]
            },
            (error, result) => {
                if (error) reject(error);
                else {
                    const downloadUrl = cloudinary.url(result!.public_id, {
                        resource_type: result!.resource_type,
                        flags: `attachment:${file.originalname}`,
                        secure: true
                    });

                    resolve({
                        type: "FILE",
                        name: file.originalname,
                        extension: fileExtension,
                        mimeType: file.mimetype,
                        url: result?.secure_url,
                        downloadUrl: downloadUrl,
                        size: file.size,
                        publicId: result?.public_id
                    });
                }
            }
        );
        uploadStream.end(file.buffer);
    });
};

export const uploadBufferToCloudinary = (buffer: Buffer, fileName: string, folder: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const uploadFolder = getCloudinaryFolder(folder);
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;

        const safeFileName = fileNameWithoutExt
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, '_');

        const publicIdWithExtension = fileExtension ? `${safeFileName}.${fileExtension}` : safeFileName;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                folder: uploadFolder,
                public_id: publicIdWithExtension,
                use_filename: true,
                unique_filename: true,
            },
            (error, result) => {
                if (error) return reject(error);
                const downloadUrl = cloudinary.url(result!.public_id, {
                    resource_type: result!.resource_type,
                    flags: `attachment:${fileName}`,
                    secure: true
                });
                resolve({
                    url: result?.secure_url,
                    downloadUrl,
                    publicId: result?.public_id
                });
            }
        );
        uploadStream.end(buffer);
    });
};

export const streamUploadToCloudinary = (diskFile: Express.Multer.File, folder: string): Promise<any> => {
    return new Promise((resolve, reject) => {
        const uploadFolder = getCloudinaryFolder(folder);
        const fileExtension = diskFile.originalname.split('.').pop()?.toLowerCase() || '';
        const fileNameWithoutExt = diskFile.originalname.substring(0, diskFile.originalname.lastIndexOf('.')) || diskFile.originalname;

        const safeFileName = fileNameWithoutExt
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]/g, '_');

        const publicIdWithExtension = fileExtension ? `${safeFileName}.${fileExtension}` : safeFileName;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: "auto",
                folder: uploadFolder,
                public_id: publicIdWithExtension,
                use_filename: true,
                unique_filename: true,
            },
            (error, result) => {
                fs.unlink(diskFile.path, () => {});
                if (error) return reject(error);
                const downloadUrl = cloudinary.url(result!.public_id, {
                    resource_type: result!.resource_type,
                    flags: `attachment:${diskFile.originalname}`,
                    secure: true
                });
                resolve({
                    type: "FILE",
                    name: diskFile.originalname,
                    extension: fileExtension,
                    mimeType: diskFile.mimetype,
                    url: result?.secure_url,
                    downloadUrl,
                    size: diskFile.size,
                    publicId: result?.public_id
                });
            }
        );
        fs.createReadStream(diskFile.path).pipe(uploadStream);
    });
};

/**
 * Extract Cloudinary publicId and resourceType from secure_url
 */
export const parseCloudinaryAssetInfo = (url: string, declaredType?: string): { publicId: string; resourceType: 'image' | 'video' | 'raw' } => {
    if (!url) return { publicId: '', resourceType: 'image' };

    // Determine resource_type from url or declared type
    let resourceType: 'image' | 'video' | 'raw' = 'image';
    if (url.includes('/video/upload/') || declaredType?.includes('audio') || url.match(/\.(m4a|mp3|wav|ogg|webm|mp4)($|\?)/i)) {
        resourceType = 'video'; // Cloudinary treats audio under video
    } else if (url.includes('/raw/upload/') || (!url.includes('/image/upload/') && !url.match(/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i))) {
        resourceType = 'raw';
    }

    try {
        const urlWithoutQuery = url.split('?')[0];
        const uploadIndex = urlWithoutQuery.indexOf('/upload/');
        if (uploadIndex === -1) {
            return { publicId: '', resourceType };
        }

        // Get substring after /upload/
        let afterUpload = urlWithoutQuery.substring(uploadIndex + '/upload/'.length);
        // Remove version string like v1729987899/
        afterUpload = afterUpload.replace(/^v\d+\//, '');

        // If image or video, remove the file extension from publicId
        if (resourceType === 'image' || resourceType === 'video') {
            afterUpload = afterUpload.replace(/\.[a-zA-Z0-9]+$/, '');
        }

        return {
            publicId: decodeURIComponent(afterUpload),
            resourceType
        };
    } catch {
        return { publicId: '', resourceType };
    }
};

/**
 * Destroy/delete an asset on Cloudinary safely
 */
export const destroyCloudinaryAsset = async (publicId: string, resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<boolean> => {
    if (!publicId) return false;
    try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        return result?.result === 'ok';
    } catch (err: any) {
        console.warn(`[Cloudinary] Failed to destroy asset ${publicId}:`, err?.message || err);
        return false;
    }
};

/**
 * Add archive tag to a Cloudinary asset
 */
export const tagCloudinaryAsset = async (publicId: string, tag: string = 'recalled_archive', resourceType: 'image' | 'video' | 'raw' = 'image'): Promise<boolean> => {
    if (!publicId) return false;
    try {
        await cloudinary.uploader.add_tag(tag, [publicId], { resource_type: resourceType });
        return true;
    } catch (err: any) {
        console.warn(`[Cloudinary] Failed to tag asset ${publicId}:`, err?.message || err);
        return false;
    }
};

