import { Response } from "express";
import { MotionGenerationService } from "../services/MotionGeneration.Service";
import { CreateMotionControlVideoDto } from "../dto/CreateVideo.dto";

export class MotionGenerationController {
    private motionGenerationService = new MotionGenerationService();

    create = async (req: any, res: Response) => {
        try {
            const body = req.body;
            const files = req.files as {
                characterImage?: Express.Multer.File[];
                referenceVideo?: Express.Multer.File[];
            };

            const characterImage = files?.characterImage?.[0];
            const referenceVideo = files?.referenceVideo?.[0];
            const characterImageAssetId = body.characterImageAssetId ? Number(body.characterImageAssetId) : undefined;
            const referenceVideoAssetId = body.referenceVideoAssetId ? Number(body.referenceVideoAssetId) : undefined;

            if (!body.projectId) {
                return res.status(400).json({ message: "projectId là bắt buộc" });
            }
            if (!body.modelId) {
                return res.status(400).json({ message: "modelId là bắt buộc" });
            }
            if (!characterImage && !characterImageAssetId) {
                return res.status(400).json({ message: "Character image là bắt buộc (file hoặc characterImageAssetId)" });
            }
            if (!referenceVideo && !referenceVideoAssetId) {
                return res.status(400).json({ message: "Reference video là bắt buộc (file hoặc referenceVideoAssetId)" });
            }

            const dto: CreateMotionControlVideoDto = {
                projectId: body.projectId,
                modelId: body.modelId,
                prompt: body.prompt,
                negativePrompt: body.negativePrompt,
                characterOrientation: body.characterOrientation || "image",
                keepOriginalSound: body.keepOriginalSound ?? "yes",
                mode: body.mode || "pro",
                cost: body.cost ? Math.round(Number(body.cost)) : 0,
                characterImageAssetId,
                referenceVideoAssetId,
            };

            const result = await this.motionGenerationService.createMotionControlVideo(
                req.user.id, dto, characterImage, referenceVideo,
            );
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    getStatus = async (req: any, res: Response) => {
        try {
            const result = await this.motionGenerationService.getStatus(Number(req.params.id));
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    getHistory = async (req: any, res: Response) => {
        try {
            const result = await this.motionGenerationService.getHistory(req.user.id, req.query.projectId as string);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };
}