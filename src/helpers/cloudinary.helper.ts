import cloudinary from '../config/cloudinary';

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
                folder: folder,
                public_id: publicIdWithExtension,
                use_filename: true,
                unique_filename: true
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
