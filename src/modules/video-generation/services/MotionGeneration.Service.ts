import { AppDataSource } from "../../../data-source";
import { MotionGenerations } from "../entities/MotionGeneration.entity";
import { AiModels } from "../../ai-model/entities/AiModel.entity";
import { Projects } from "../../project/entities/Project.entity";
import { AssetService } from "../../asset/services/Asset.Service";
import { CloudinaryVideoAiService } from "../../cloudinary/services/CloudinaryVideoAi.Service";
import { KlingService } from "../../kling/services/Kling.Service";
import { CreateMotionControlVideoDto } from "../dto/CreateVideo.dto";

export class MotionGenerationService {
    private motionGenRepository = AppDataSource.getRepository(MotionGenerations);
    private modelRepository = AppDataSource.getRepository(AiModels);
    private projectRepository = AppDataSource.getRepository(Projects);

    private assetService = new AssetService();
    private cloudinaryVideoAiService = new CloudinaryVideoAiService();
    private klingService = new KlingService();

    async createMotionControlVideo(
        userId: string,
        dto: CreateMotionControlVideoDto,
        characterImageFile?: Express.Multer.File,
        referenceVideoFile?: Express.Multer.File,
    ) {
        if (!dto.projectId) throw new Error("projectId là bắt buộc");
        const project = await this.projectRepository.findOne({ where: { id: dto.projectId } });
        if (!project) throw new Error("Không tìm thấy project");

        const model = await this.modelRepository.findOne({ where: { id: dto.modelId } });
        if (!model) throw new Error("Model không tồn tại");
        if (!model.supportsMotionControl) {
            throw new Error("Model không hỗ trợ Motion Control");
        }

        const baseFolder = `ai-generation/users/${userId}/projects/${dto.projectId}/motion`;

        // ── Resolve character image ──────────────────────────────────────────
        const characterAsset = await this.assetService.resolveImageAsset(
            userId, dto.characterImageAssetId, characterImageFile, `${baseFolder}/images`, "character", "image_begin",
        );
        if (!characterAsset) throw new Error("Cần cung cấp characterImage hoặc characterImageAssetId");
        await this.assetService.attachProjectIfMissing(characterAsset.id, dto.projectId);

        // ── Resolve reference video (asset có sẵn hoặc placeholder để upload nền) ──
        const { asset: referenceVideoAsset, needUpload } = await this.assetService.resolveVideoAsset(
            userId, dto.projectId, dto.referenceVideoAssetId, referenceVideoFile,
        );

        const motionGen = this.motionGenRepository.create({
            projectId: dto.projectId,
            modelId: dto.modelId,
            userId,
            characterImageAssetId: characterAsset.id,
            motionReferenceAssetId: referenceVideoAsset.id,
            motionPrompt: dto.prompt || "",
            negativePrompt: dto.negativePrompt,
            status: "queued",
            externalTaskId: "",
            durationSeconds: 5,
            characterOrientation: dto.characterOrientation,
            generationSound: dto.keepOriginalSound === "yes",
            generationMode: dto.mode || "pro",
            cost: dto.cost ?? 0,
            params: { mode: dto.mode, characterOrientation: dto.characterOrientation },
            requestPayload: {},
            responsePayload: {},
            startedAt: new Date(),
        });

        const saved = await this.motionGenRepository.save(motionGen);

        this.runMotionControlInBackground({
            motionGen: saved,
            referenceVideoFile: needUpload ? referenceVideoFile : undefined,
            characterAsset,
            referenceVideoAsset,
            dto,
            userId,
            baseFolder,
            model,
        }).catch((err) => console.error(`[MotionControl] Background error: ${err.message}`));

        return {
            message: "Đang xử lý, vui lòng chờ...",
            motionGenerationId: saved.id,
            projectId: dto.projectId,
            status: "queued",
            characterImageUrl: characterAsset.storedUrl,
            referenceVideoUrl: referenceVideoAsset.storedUrl || null,
            promptSent: dto.prompt || "",
            modelName: model.name,
            generationMode: dto.mode || "pro",
            cost: dto.cost ?? 0,
        };
    }

    private async runMotionControlInBackground({
        motionGen, referenceVideoFile, characterAsset, referenceVideoAsset, dto, userId, baseFolder, model,
    }: any) {
        try {
            let videoUrlForKling = referenceVideoAsset.storedUrl;

            if (referenceVideoFile) {
                const videoUpload = await this.cloudinaryVideoAiService.uploadVideoBuffer(
                    referenceVideoFile.buffer, `${baseFolder}/videos/reference`, `ref_${Date.now()}`,
                );
                await this.assetService.updateAsset(referenceVideoAsset.id, {
                    originalUrl: videoUpload.secure_url,
                    storedUrl: videoUpload.secure_url,
                    metadata: { cloudinary_public_id: videoUpload.public_id },
                });
                videoUrlForKling = videoUpload.secure_url;
            }

            const klingCreate = await this.klingService.createMotionControl({
                modelName: model.code,
                imageUrl: characterAsset.storedUrl,
                videoUrl: videoUrlForKling,
                prompt: dto.prompt || "",
                keepOriginalSound: dto.keepOriginalSound ?? "yes",
                characterOrientation: dto.characterOrientation,
                mode: dto.mode || "pro",
            });

            if (klingCreate.code !== 0) {
                await this.motionGenRepository.update(motionGen.id, {
                    status: "failed",
                    errorMessage: klingCreate.message,
                    completedAt: new Date(),
                });
                return;
            }

            const taskId = klingCreate.data.task_id;

            await this.motionGenRepository.update(motionGen.id, {
                externalTaskId: taskId,
                status: "processing",
                requestPayload: klingCreate as any,
                responsePayload: klingCreate as any,
            });

            await this.pollMotionControlResult(motionGen.id, taskId, userId, characterAsset.id);
        } catch (err: any) {
            console.error(`[MotionControl BG ${motionGen.id}] FAILED: ${err.message}`);
            await this.motionGenRepository.update(motionGen.id, {
                status: "failed",
                errorMessage: err.message,
                completedAt: new Date(),
            });
        }
    }

    private async pollMotionControlResult(
        motionGenId: number, taskId: string, userId: string, characterImageAssetId: number,
    ) {
        try {
            const taskResult = await this.klingService.pollMotionControlUntilDone(taskId, 30000, 40);
            const videoData = taskResult.task_result?.videos?.[0];
            if (!videoData) throw new Error("Kling trả về succeed nhưng không có video URL");

            const motionGen = await this.motionGenRepository.findOne({ where: { id: motionGenId } });
            const cloudinaryVideoUrl = await this.cloudinaryVideoAiService.uploadVideoFromUrl(
                videoData.url,
                `ai-generation/users/${userId}/projects/${motionGen?.projectId}/motion/output`,
                `motion_${motionGenId}_${Date.now()}`,
            );

            const videoAsset = await this.assetService.createGeneratedAsset({
                userId,
                projectId: motionGen?.projectId,
                assetType: "video",
                assetRole: "scene_video",
                sourceType: "generated",
                originalUrl: videoData.url,
                storedUrl: cloudinaryVideoUrl,
                storageProvider: "cloudinary",
                durationSeconds: videoData.duration ? Math.round(parseFloat(videoData.duration)) : undefined,
                metadata: { kling_video_id: videoData.id, duration: videoData.duration },
            });

            await this.motionGenRepository.update(motionGenId, {
                status: "succeeded",
                outputAssetId: videoAsset.id,
                thumbnailAssetId: characterImageAssetId,
                completedAt: new Date(),
                resultPayload: taskResult as any,
            });
        } catch (err: any) {
            console.error(`[MotionControl ${motionGenId}] FAILED: ${err.message}`);
            await this.motionGenRepository.update(motionGenId, {
                status: "failed",
                errorMessage: err.message,
                completedAt: new Date(),
            });
        }
    }

    async getHistory(userId: string, projectId?: string) {
        const qb = this.motionGenRepository
            .createQueryBuilder("mg")
            .leftJoinAndSelect("mg.outputAsset", "outputAsset")
            .leftJoinAndSelect("mg.characterImageAsset", "characterImageAsset")
            .leftJoinAndSelect("mg.motionReferenceAsset", "motionReferenceAsset")
            .leftJoinAndSelect("mg.model", "model")
            .leftJoinAndSelect("model.provider", "provider")
            .where("mg.user_id = :userId", { userId });

        if (projectId) {
            qb.andWhere("mg.project_id = :projectId", { projectId });
        }

        const list = await qb.orderBy("mg.created_at", "DESC").limit(50).getMany();

        return list.map((mg) => ({
            id: mg.id,
            status: mg.status,
            promptSent: mg.motionPrompt,
            videoUrl: mg.outputAsset?.storedUrl ?? null,
            thumbnailUrl: mg.characterImageAsset?.storedUrl ?? null,
            characterImageUrl: mg.characterImageAsset?.storedUrl ?? null,
            referenceVideoUrl: mg.motionReferenceAsset?.storedUrl ?? null,
            modelName: mg.model?.name ?? "Unknown",
            providerName: mg.model?.provider?.name ?? "Unknown",
            characterOrientation: mg.characterOrientation,
            durationSeconds: mg.durationSeconds,
            generationMode: mg.generationMode,
            cost: mg.cost ?? 0,
            createdAt: mg.createdAt,
        }));
    }

    async getStatus(id: number) {
        const motionGen = await this.motionGenRepository.findOne({
            where: { id },
            relations: ["outputAsset", "characterImageAsset", "motionReferenceAsset"],
        });
        if (!motionGen) throw new Error("Không tìm thấy motion generation");

        return {
            id: motionGen.id,
            status: motionGen.status,
            taskId: motionGen.externalTaskId,
            promptSent: motionGen.motionPrompt,
            characterImageUrl: motionGen.characterImageAsset?.storedUrl ?? null,
            referenceVideoUrl: motionGen.motionReferenceAsset?.storedUrl ?? null,
            videoUrl: motionGen.outputAsset?.storedUrl ?? null,
            duration: motionGen.durationSeconds,
            errorMessage: motionGen.errorMessage ?? null,
            createdAt: motionGen.createdAt,
            completedAt: motionGen.completedAt ?? null,
        };
    }
}