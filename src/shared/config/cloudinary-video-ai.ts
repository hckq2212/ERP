export const cloudinaryVideoAiConfig = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME_1,
    api_key: process.env.CLOUDINARY_API_KEY_1,
    api_secret: process.env.CLOUDINARY_API_SECRET_1,
};

export const assertCloudinaryVideoAiConfig = () => {
    const { cloud_name, api_key, api_secret } = cloudinaryVideoAiConfig;
    if (!cloud_name || !api_key || !api_secret) {
        throw new Error(
            "Thiếu cấu hình Cloudinary Video AI: kiểm tra CLOUDINARY_CLOUD_NAME_1 / CLOUDINARY_API_KEY_1 / CLOUDINARY_API_SECRET_1 trong .env"
        );
    }
};