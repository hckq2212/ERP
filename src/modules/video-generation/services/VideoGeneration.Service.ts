import { AppDataSource } from "../../../data-source";
import { VideoGenerations } from "../entities/VideoGeneration.entity";
import { AiModels } from "../../ai-model/entities/AiModel.entity";
import { Projects } from "../../project/entities/Project.entity";
import { AssetService } from "../../asset/services/Asset.Service";
import { CloudinaryVideoAiService } from "../../cloudinary/services/CloudinaryVideoAi.Service";
import { KlingService } from "../../kling/services/Kling.Service";
import { ByteplusService } from "../../byteplus/services/Byteplus.Service";
import { CreateVideoDto } from "../dto/CreateVideo.dto";

export class VideoGenerationService {
    private videoGenRepository = AppDataSource.getRepository(VideoGenerations);
    private modelRepository = AppDataSource.getRepository(AiModels);
    private projectRepository = AppDataSource.getRepository(Projects);

    private assetService = new AssetService();
    private cloudinaryVideoAiService = new CloudinaryVideoAiService();
    private klingService = new KlingService();
    private byteplusService = new ByteplusService();

    async createVideo(
        userId: string,
        dto: CreateVideoDto,
        startImageFile?: Express.Multer.File,
        endImageFile?: Express.Multer.File,
    ) {
        // 1. Validate project (BẮT BUỘC là project ERP có sẵn)
        if (!dto.projectId) throw new Error("projectId là bắt buộc");
        const project = await this.projectRepository.findOne({ where: { id: dto.projectId } });
        if (!project) throw new Error("Không tìm thấy project");

        // 2. Validate model
        const model = await this.modelRepository.findOne({
            where: { id: dto.modelId },
            relations: ["provider"],
        });
        if (!model) throw new Error("Model không tồn tại");
        if (model.modelType !== "video_generation") {
            throw new Error("Model không phải video generation");
        }

        const isByteplus = model.provider?.code === "byteplus";

        // 3. Validate multi-shot (chỉ Kling hỗ trợ; BytePlus không hỗ trợ multi-shot)
        if (!isByteplus && dto.multiShot) {
            if (!dto.shotType) throw new Error("shotType là bắt buộc khi multiShot=true");
            if (dto.shotType === "customize") {
                if (!dto.multiPrompt || dto.multiPrompt.length === 0) {
                    throw new Error("multiPrompt là bắt buộc khi shotType=customize");
                }
                const totalShotDuration = dto.multiPrompt.reduce((sum, s) => sum + Number(s.duration), 0);
                const videoDuration = Number(dto.duration || 5);
                if (totalShotDuration !== videoDuration) {
                    throw new Error(
                        `Tổng duration của shots (${totalShotDuration}s) phải bằng duration video (${videoDuration}s)`,
                    );
                }
            } else if (dto.shotType === "intelligence") {
                if (!dto.prompt?.trim()) throw new Error("prompt là bắt buộc khi shotType=intelligence");
            }
        } else {
            if (!dto.prompt?.trim()) throw new Error("prompt là bắt buộc");
        }

        const baseFolder = `ai-generation/users/${userId}/projects/${dto.projectId}/videos`;

        // 4. Resolve start image (reuse asset có sẵn hoặc upload mới)
        const beginAsset = await this.assetService.resolveImageAsset(
            userId, dto.startImageAssetId, startImageFile, baseFolder, "begin", "image_begin",
        );
        if (!beginAsset) throw new Error("Cần cung cấp startImage hoặc startImageAssetId");
        await this.assetService.attachProjectIfMissing(beginAsset.id, dto.projectId);

        // 5. Resolve end image nếu có
        let endAsset = null;
        if (dto.endImageAssetId || endImageFile) {
            endAsset = await this.assetService.resolveImageAsset(
                userId, dto.endImageAssetId, endImageFile, baseFolder, "end", "image_end",
            );
            if (endAsset) await this.assetService.attachProjectIfMissing(endAsset.id, dto.projectId);
        }

        // 6. Rẽ nhánh theo provider: Kling hay BytePlus
        let externalTaskId: string;
        let responsePayloadRaw: any;

        if (isByteplus) {
            const bytePlusCreate = await this.byteplusService.createVideoTask({
                modelCode: model.code,
                prompt: dto.prompt,
                imageUrl: beginAsset.storedUrl,
                imageTailUrl: endAsset?.storedUrl,
                resolution: dto.resolution,
                ratio: dto.ratio,
                duration: Number(dto.duration || 5),
                generateAudio: dto.sound === "on",
            });
            externalTaskId = bytePlusCreate.id;
            responsePayloadRaw = bytePlusCreate;
        } else {
            const klingCreate = await this.klingService.createImageToVideo({
                modelName: model.code,
                imageUrl: beginAsset.storedUrl,
                imageTailUrl: endAsset?.storedUrl,
                prompt: dto.prompt,
                sound: dto.sound || "off",
                negativePrompt: dto.negativePrompt,
                duration: dto.duration || "5",
                mode: (dto.mode as "std" | "pro" | "4k") || "pro",
                multiShot: dto.multiShot,
                shotType: dto.shotType,
                multiPrompt: dto.multiPrompt,
            });

            if (klingCreate.code !== 0) {
                throw new Error(`Kling error: ${klingCreate.message}`);
            }
            externalTaskId = klingCreate.data.task_id;
            responsePayloadRaw = klingCreate;
        }

        // 7. Lưu video_generations
        const storedPrompt = this.buildStoredPrompt(dto, isByteplus);

        const videoGen = this.videoGenRepository.create({
            projectId: dto.projectId,
            modelId: dto.modelId,
            userId,
            imageBeginAssetId: beginAsset.id,
            imageEndAssetId: endAsset?.id,
            motionPrompt: storedPrompt,
            negativePrompt: dto.negativePrompt,
            status: "queued",
            externalTaskId,
            durationSeconds: Number(dto.duration || 5),
            generationMode: isByteplus ? (dto.resolution || "720p") : (dto.mode || "std"),
            generationRatio: isByteplus ? dto.ratio : undefined,
            generationSound: dto.sound === "on",
            cost: dto.cost ?? 0,
            params: {
                resolution: dto.resolution,
                ratio: dto.ratio,
                mode: dto.mode,
                multiShot: dto.multiShot ?? false,
                shotType: dto.shotType,
            },
            requestPayload: {
                modelName: model.code,
                prompt: dto.prompt,
                duration: dto.duration,
                mode: dto.mode,
                ratio: dto.ratio,
                sound: dto.sound,
                multiShot: dto.multiShot ?? false,
                shotType: dto.shotType,
                multiPrompt: dto.multiPrompt,
            },
            responsePayload: responsePayloadRaw,
            startedAt: new Date(),
        });

        const saved = await this.videoGenRepository.save(videoGen);

        // 8. Polling ngầm — chọn theo provider
        if (isByteplus) {
            this.pollAndSaveResultByteplus(saved.id, externalTaskId, userId).catch((err) =>
                console.error(`[VideoGen] BytePlus polling error: ${err.message}`),
            );
        } else {
            this.pollAndSaveResult(saved.id, externalTaskId, userId).catch((err) =>
                console.error(`[VideoGen] Kling polling error: ${err.message}`),
            );
        }

        return {
            message: "Đang tạo video, vui lòng chờ...",
            videoGenerationId: saved.id,
            projectId: dto.projectId,
            taskId: externalTaskId,
            status: "queued",
            beginImageUrl: beginAsset.storedUrl,
            endImageUrl: endAsset?.storedUrl ?? null,
            promptSent: storedPrompt,
            modelName: model.name,
            generationMode: isByteplus ? (dto.resolution || "720p") : (dto.mode || "pro"),
            multiShot: !isByteplus && (dto.multiShot ?? false),
            shotType: dto.shotType,
            cost: dto.cost ?? 0,
        };
    }

    private buildStoredPrompt(dto: CreateVideoDto, isByteplus = false): string {
        if (!isByteplus && dto.multiShot && dto.shotType === "customize" && dto.multiPrompt?.length) {
            return dto.multiPrompt.map((s) => `[Shot ${s.index}] ${s.prompt} (${s.duration}s)`).join(" | ");
        }
        return dto.prompt || "";
    }

    private async pollAndSaveResult(videoGenId: number, taskId: string, userId: string) {
        try {
            await this.videoGenRepository.update(videoGenId, { status: "processing" });
            const taskResult = await this.klingService.pollUntilDone(taskId, 30000, 40);
            const videoData = taskResult.task_result?.videos?.[0];
            if (!videoData) throw new Error("Kling trả về succeed nhưng không có video URL");

            const videoGen = await this.videoGenRepository.findOne({ where: { id: videoGenId } });
            const cloudinaryVideoUrl = await this.cloudinaryVideoAiService.uploadVideoFromUrl(
                videoData.url,
                `ai-generation/users/${userId}/projects/${videoGen?.projectId}/videos/output`,
                `video_${videoGenId}_${Date.now()}`,
            );

            const videoAsset = await this.assetService.createGeneratedAsset({
                userId,
                projectId: videoGen?.projectId,
                assetType: "video",
                assetRole: "scene_video",
                sourceType: "generated",
                originalUrl: videoData.url,
                storedUrl: cloudinaryVideoUrl,
                storageProvider: "cloudinary",
                durationSeconds: videoData.duration ? Math.round(parseFloat(videoData.duration)) : undefined,
                metadata: { kling_video_id: videoData.id, duration: videoData.duration },
            });

            await this.videoGenRepository.update(videoGenId, {
                status: "succeeded",
                outputAssetId: videoAsset.id,
                completedAt: new Date(),
                resultPayload: taskResult as any,
            });
        } catch (err: any) {
            console.error(`[VideoGen ${videoGenId}] FAILED: ${err.message}`);
            await this.videoGenRepository.update(videoGenId, {
                status: "failed",
                errorMessage: err.message,
                completedAt: new Date(),
            });
        }
    }

    private async pollAndSaveResultByteplus(videoGenId: number, taskId: string, userId: string) {
        try {
            await this.videoGenRepository.update(videoGenId, { status: "processing" });
            const taskResult = await this.byteplusService.pollUntilDone(taskId, 30000, 40);
            const videoUrl = taskResult.content?.video_url;
            if (!videoUrl) throw new Error("BytePlus trả về succeeded nhưng không có video URL");

            const videoGen = await this.videoGenRepository.findOne({ where: { id: videoGenId } });
            const cloudinaryVideoUrl = await this.cloudinaryVideoAiService.uploadVideoFromUrl(
                videoUrl,
                `ai-generation/users/${userId}/projects/${videoGen?.projectId}/videos/output`,
                `video_${videoGenId}_${Date.now()}`,
            );

            const videoAsset = await this.assetService.createGeneratedAsset({
                userId,
                projectId: videoGen?.projectId,
                assetType: "video",
                assetRole: "scene_video",
                sourceType: "generated",
                originalUrl: videoUrl,
                storedUrl: cloudinaryVideoUrl,
                storageProvider: "cloudinary",
                durationSeconds: taskResult.duration ? Math.round(Number(taskResult.duration)) : undefined,
                metadata: { byteplus_task_id: taskResult.id, duration: taskResult.duration },
            });

            await this.videoGenRepository.update(videoGenId, {
                status: "succeeded",
                outputAssetId: videoAsset.id,
                completedAt: new Date(),
                resultPayload: taskResult as any,
            });
        } catch (err: any) {
            console.error(`[VideoGen ${videoGenId}] BytePlus FAILED: ${err.message}`);
            await this.videoGenRepository.update(videoGenId, {
                status: "failed",
                errorMessage: err.message,
                completedAt: new Date(),
            });
        }
    }

    async getStatus(id: number) {
        const videoGen = await this.videoGenRepository.findOne({
            where: { id },
            relations: ["outputAsset", "imageBeginAsset", "imageEndAsset"],
        });
        if (!videoGen) throw new Error("Không tìm thấy video generation");

        return {
            id: videoGen.id,
            status: videoGen.status,
            taskId: videoGen.externalTaskId,
            promptSent: videoGen.motionPrompt,
            beginImageUrl: videoGen.imageBeginAsset?.storedUrl ?? null,
            endImageUrl: videoGen.imageEndAsset?.storedUrl ?? null,
            videoUrl: videoGen.outputAsset?.storedUrl ?? null,
            duration: videoGen.durationSeconds,
            errorMessage: videoGen.errorMessage ?? null,
            createdAt: videoGen.createdAt,
            completedAt: videoGen.completedAt ?? null,
        };
    }

    async getHistory(userId: string, projectId?: string) {
        const qb = this.videoGenRepository
            .createQueryBuilder("vg")
            .leftJoinAndSelect("vg.outputAsset", "outputAsset")
            .leftJoinAndSelect("vg.imageBeginAsset", "imageBeginAsset")
            .leftJoinAndSelect("vg.imageEndAsset", "imageEndAsset")
            .leftJoinAndSelect("vg.model", "model")
            .leftJoinAndSelect("model.provider", "provider")
            .where("vg.user_id = :userId", { userId });

        if (projectId) {
            qb.andWhere("vg.project_id = :projectId", { projectId });
        }

        const list = await qb.orderBy("vg.created_at", "DESC").limit(50).getMany();

        return list.map((vg) => ({
            id: vg.id,
            status: vg.status,
            promptSent: vg.motionPrompt,
            videoUrl: vg.outputAsset?.storedUrl ?? null,
            thumbnailUrl: vg.imageBeginAsset?.storedUrl ?? null,
            beginImageUrl: vg.imageBeginAsset?.storedUrl ?? null,
            endImageUrl: vg.imageEndAsset?.storedUrl ?? null,
            modelName: vg.model?.name ?? "Unknown",
            providerName: vg.model?.provider?.name ?? "Unknown",
            durationSeconds: vg.durationSeconds,
            generationMode: vg.generationMode,
            cost: vg.cost ?? 0,
            createdAt: vg.createdAt,
        }));
    }
}