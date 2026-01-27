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
