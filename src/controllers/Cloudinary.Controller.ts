import { Request, Response } from "express";
import cloudinary from "../config/cloudinary";

export class CloudinaryController {
    /**
     * Get signature for direct client-side upload
     * This is the secure way to upload from browser directly to Cloudinary
     */
    getSignature = async (req: Request, res: Response) => {
        try {
            const folder = req.query.folder as string || "GETVINI/ERP/others";
            const timestamp = Math.round(new Date().getTime() / 1000);

            // Use process.env directly
            const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
            const apiKey = process.env.CLOUDINARY_API_KEY;
            const apiSecret = process.env.CLOUDINARY_API_SECRET;

            // Log status for server-side debugging
            console.log(`[Cloudinary DEBUG] cloudName: ${cloudName}, apiKey: ${apiKey ? 'exists' : 'missing'}, apiSecret: ${apiSecret ? 'exists' : 'missing'}`);

            if (!cloudName || cloudName === 'undefined' || !apiKey || apiKey === 'undefined' || !apiSecret) {
                console.error("[Cloudinary] CONFIGURATION ERROR: Missing or invalid keys in .env", { cloudName, apiKey });
                return res.status(500).json({
                    message: "Cấu hình Cloudinary trên server không hợp lệ (undefined hoặc thiếu keys).",
                    debug_info: { cloudName: String(cloudName), hasApiKey: !!apiKey }
                });
            }

            const signature = cloudinary.utils.api_sign_request(
                {
                    timestamp: timestamp,
                    folder: folder,
                },
                apiSecret
            );

            res.status(200).json({
                signature,
                timestamp,
                cloud_name: cloudName,
                api_key: apiKey,
                folder: folder
            });
        } catch (error: any) {
            console.error("[Cloudinary] Error generating signature:", error.message);
            res.status(500).json({ message: error.message });
        }
    }
}
