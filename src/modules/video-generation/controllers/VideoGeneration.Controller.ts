import { Response } from "express";
import { VideoGenerationService } from "../services/VideoGeneration.Service";
import { CreateVideoDto } from "../dto/CreateVideo.dto";

export class VideoGenerationController {
    private videoGenerationService = new VideoGenerationService();

    create = async (req: any, res: Response) => {
        try {
            const body = req.body;
            const files = req.files as {
                startImage?: Express.Multer.File[];
                endImage?: Express.Multer.File[];
            };

            const startImage = files?.startImage?.[0];
            const startImageAssetId = body.startImageAssetId ? Number(body.startImageAssetId) : undefined;
            const endImageAssetId = body.endImageAssetId ? Number(body.endImageAssetId) : undefined;

            if (!body.projectId) {
                return res.status(400).json({ message: "projectId là bắt buộc" });
            }
            if (!body.modelId) {
                return res.status(400).json({ message: "modelId là bắt buộc" });
            }
            if (!startImage && !startImageAssetId) {
                return res.status(400).json({ message: "Start image là bắt buộc (file hoặc startImageAssetId)" });
            }

            const multiShot = body.multiShot === "true" || body.multiShot === true;
            const shotType = body.shotType as "customize" | "intelligence" | undefined;

            let multiPrompt: any;
            if (multiShot && shotType === "customize" && body.multiPrompt) {
                try {
                    multiPrompt = typeof body.multiPrompt === "string" ? JSON.parse(body.multiPrompt) : body.multiPrompt;
                } catch {
                    return res.status(400).json({ message: "multiPrompt không hợp lệ, phải là JSON array" });
                }
                if (!Array.isArray(multiPrompt) || multiPrompt.length === 0) {
                    return res.status(400).json({ message: "multiPrompt phải là array có ít nhất 1 phần tử" });
                }
                if (multiPrompt.length > 6) {
                    return res.status(400).json({ message: "multiPrompt tối đa 6 storyboard" });
                }
            }

            const dto: CreateVideoDto = {
                projectId: body.projectId,
                modelId: body.modelId,
                resolution: body.resolution || "720p",
                prompt: body.prompt || "",
                negativePrompt: body.negativePrompt,
                duration: body.duration || "5",
                mode: body.mode || "pro",
                sound: body.sound || "off",
                ratio: body.ratio,
                cost: body.cost ? Math.round(Number(body.cost)) : 0,
                multiShot,
                shotType,
                multiPrompt,
                startImageAssetId,
                endImageAssetId,
            };

            const result = await this.videoGenerationService.createVideo(
                req.user.id, dto, startImage, files?.endImage?.[0],
            );
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    getStatus = async (req: any, res: Response) => {
        try {
            const result = await this.videoGenerationService.getStatus(Number(req.params.id));
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    getHistory = async (req: any, res: Response) => {
        try {
            const result = await this.videoGenerationService.getHistory(req.user.id, req.query.projectId as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };
}