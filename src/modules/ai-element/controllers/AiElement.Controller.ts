import { Response } from "express";
import { AiElementService } from "../services/AiElement.Service";
import { CreateElementDto } from "../dto/CreateElement.dto";

export class AiElementController {
    private aiElementService = new AiElementService();

    create = async (req: any, res: Response) => {
        try {
            const body = req.body;
            const files = req.files as {
                frontalImage?: Express.Multer.File[];
                referImages?: Express.Multer.File[];
                video?: Express.Multer.File[];
            };

            if (!body.providerId) {
                return res.status(400).json({ message: "providerId là bắt buộc" });
            }
            if (!body.referenceType || !["image_refer", "video_refer"].includes(body.referenceType)) {
                return res.status(400).json({ message: "referenceType phải là image_refer hoặc video_refer" });
            }

            let referImageAssetIds: number[] | undefined;
            if (body.referImageAssetIds) {
                try {
                    referImageAssetIds = typeof body.referImageAssetIds === "string"
                        ? JSON.parse(body.referImageAssetIds)
                        : body.referImageAssetIds;
                } catch {
                    return res.status(400).json({ message: "referImageAssetIds không hợp lệ, phải là JSON array" });
                }
            }

            const dto: CreateElementDto = {
                providerId: body.providerId,
                referenceType: body.referenceType,
                elementName: body.elementName,
                elementDescription: body.elementDescription,
                elementVoiceId: body.elementVoiceId || undefined,
                frontalImageAssetId: body.frontalImageAssetId ? Number(body.frontalImageAssetId) : undefined,
                referImageAssetIds,
                videoAssetId: body.videoAssetId ? Number(body.videoAssetId) : undefined,
            };

            const result = await this.aiElementService.create(req.user.id, dto, {
                frontalImage: files?.frontalImage?.[0],
                referImages: files?.referImages,
                video: files?.video?.[0],
            });
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    getHistory = async (req: any, res: Response) => {
        try {
            const result = await this.aiElementService.getHistory(req.user.id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getKlingTaskStatus = async (req: any, res: Response) => {
        try {
            const result = await this.aiElementService.getKlingTaskStatus(req.params.taskId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getStatus = async (req: any, res: Response) => {
        try {
            const result = await this.aiElementService.getStatus(Number(req.params.id));
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    remove = async (req: any, res: Response) => {
        try {
            const result = await this.aiElementService.remove(req.user.id, Number(req.params.id));
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    setFavorite = async (req: any, res: Response) => {
        try {
            const result = await this.aiElementService.setFavorite(
                req.user.id, Number(req.params.id), Boolean(req.body.isFavorite),
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };
}