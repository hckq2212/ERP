import { AppDataSource } from "../../../data-source";
import { AiElements } from "../entities/AiElement.entity";
import { AiElementImages } from "../entities/AiElementImage.entity";
import { AiElementVideos } from "../entities/AiElementVideo.entity";
import { Assets } from "../../asset/entities/Asset.entity";
import { AiProviders } from "../../ai-provider/entities/AiProvider.entity";
import { CloudinaryVideoAiService } from "../../cloudinary/services/CloudinaryVideoAi.Service";
import { KlingService } from "../../kling/services/Kling.Service";
import { CreateElementDto } from "../dto/CreateElement.dto";

interface ElementFiles {
    frontalImage?: Express.Multer.File;
    referImages?: Express.Multer.File[];
    video?: Express.Multer.File;
}

export class AiElementService {
    private elementRepository = AppDataSource.getRepository(AiElements);
    private elementImageRepository = AppDataSource.getRepository(AiElementImages);
    private elementVideoRepository = AppDataSource.getRepository(AiElementVideos);
    private assetRepository = AppDataSource.getRepository(Assets);
    private providerRepository = AppDataSource.getRepository(AiProviders);

    private cloudinaryVideoAiService = new CloudinaryVideoAiService();
    private klingService = new KlingService();

    async create(userId: string, dto: CreateElementDto, files: ElementFiles) {
        // 1. Validate provider
        const provider = await this.providerRepository.findOne({ where: { id: dto.providerId } });
        if (!provider) throw new Error("Provider không tồn tại");

        // 2. Validate field cơ bản
        if (!dto.elementName?.trim()) throw new Error("Tên Element là bắt buộc");
        if (dto.elementName.length > 20) throw new Error("Tên Element tối đa 20 ký tự");
        if (!dto.elementDescription?.trim()) throw new Error("Mô tả là bắt buộc");
        if (dto.elementDescription.length > 100) throw new Error("Mô tả tối đa 100 ký tự");

        if (dto.referenceType === "image_refer") {
            const hasFrontal = !!(dto.frontalImageAssetId || files.frontalImage);
            if (!hasFrontal) throw new Error("Ảnh chính diện là bắt buộc");

            const referCount = (dto.referImageAssetIds?.length ?? 0) + (files.referImages?.length ?? 0);
            if (referCount < 1 || referCount > 3) {
                throw new Error("Cần 1-3 ảnh tham chiếu bổ sung");
            }
        } else {
            const hasVideo = !!(dto.videoAssetId || files.video);
            if (!hasVideo) throw new Error("Video tham chiếu là bắt buộc");
            if (dto.elementVoiceId) {
                throw new Error("Element Voice ID chỉ áp dụng khi loại tham chiếu là ảnh");
            }
        }

        const baseFolder = `ai-generation/users/${userId}/elements`;

        // 3. Resolve assets (reuse có sẵn hoặc upload mới)
        let frontalAsset: Assets | null = null;
        let referAssets: Assets[] = [];
        let videoAsset: Assets | null = null;

        if (dto.referenceType === "image_refer") {
            frontalAsset = await this.resolveImageAsset(
                userId, dto.frontalImageAssetId, files.frontalImage, `${baseFolder}/frontal`, "frontal",
            );
            referAssets = await this.resolveMultipleImageAssets(
                userId, dto.referImageAssetIds, files.referImages, `${baseFolder}/refer`,
            );
        } else {
            videoAsset = await this.resolveVideoAsset(
                userId, dto.videoAssetId, files.video, `${baseFolder}/video`,
            );
        }

        // 4. Tạo record ai_elements (status=pending) — chưa gắn project
        const element = await this.elementRepository.save(
            this.elementRepository.create({
                userId,
                providerId: dto.providerId,
                projectId: null,
                elementName: dto.elementName,
                elementDescription: dto.elementDescription,
                referenceType: dto.referenceType,
                elementVoiceId: dto.referenceType === "image_refer" ? (dto.elementVoiceId || null) : null,
                status: "pending",
            }),
        );

        // 5. Lưu ai_element_images / ai_element_videos
        if (dto.referenceType === "image_refer") {
            const rows = [
                this.elementImageRepository.create({
                    elementId: element.id,
                    assetId: frontalAsset!.id,
                    imageRole: "frontal",
                    sortOrder: 0,
                }),
                ...referAssets.map((asset, i) =>
                    this.elementImageRepository.create({
                        elementId: element.id,
                        assetId: asset.id,
                        imageRole: "refer",
                        sortOrder: i + 1,
                    }),
                ),
            ];
            await this.elementImageRepository.save(rows);
        } else {
            await this.elementVideoRepository.save(
                this.elementVideoRepository.create({ elementId: element.id, assetId: videoAsset!.id }),
            );
        }

        // 6. Gọi Kling API tạo element (bất đồng bộ)
        const klingPayload = {
            elementName: dto.elementName,
            elementDescription: dto.elementDescription,
            referenceType: dto.referenceType,
            frontalImageUrl: frontalAsset?.storedUrl,
            referImageUrls: referAssets.map((a) => a.storedUrl),
            videoUrl: videoAsset?.storedUrl,
            elementVoiceId: dto.referenceType === "image_refer" ? dto.elementVoiceId : undefined,
        };

        const klingCreate = await this.klingService.createElement(klingPayload);

        if (klingCreate.code !== 0) {
            await this.elementRepository.update(element.id, {
                status: "failed",
                errorMessage: klingCreate.message,
                responsePayload: klingCreate as any,
            });
            throw new Error(`Kling error: ${klingCreate.message}`);
        }

        const taskId = klingCreate.data.task_id;

        await this.elementRepository.update(element.id, {
            status: "processing",
            externalElementId: taskId, // tạm = task_id, sẽ bị ghi đè bằng element_id thật khi succeeded
            requestPayload: klingPayload as any,
            responsePayload: klingCreate as any,
        });

        // 7. Poll ngầm — không block response
        this.pollAndSaveElementResult(element.id, taskId).catch((err) =>
            console.error(`[AiElement] Polling error: ${err.message}`),
        );

        return {
            message: "Đang tạo element, vui lòng chờ...",
            elementId: element.id,
            taskId,
            status: "processing",
            frontalImageUrl: frontalAsset?.storedUrl ?? null,
            referImageUrls: referAssets.map((a) => a.storedUrl),
            videoUrl: videoAsset?.storedUrl ?? null,
        };
    }

    private async pollAndSaveElementResult(elementId: number, taskId: string) {
        try {
            const taskResult = await this.klingService.pollElementUntilDone(taskId, 5000, 30);
            const resultElement = taskResult.task_result?.elements?.[0];

            if (!resultElement) {
                throw new Error("Kling trả về succeed nhưng không có element data");
            }

            await this.elementRepository.update(elementId, {
                status: "succeeded",
                externalElementId: String(resultElement.element_id),
                responsePayload: taskResult as any,
            });

            console.log(`[AiElement ${elementId}] DONE - Kling elementId: ${resultElement.element_id}`);
        } catch (err: any) {
            console.error(`[AiElement ${elementId}] FAILED: ${err.message}`);
            await this.elementRepository.update(elementId, {
                status: "failed",
                errorMessage: err.message,
            });
        }
    }

    private async resolveImageAsset(
        userId: string,
        assetId: number | undefined,
        file: Express.Multer.File | undefined,
        folder: string,
        publicIdPrefix: string,
    ): Promise<Assets | null> {
        if (assetId) {
            const asset = await this.assetRepository.findOne({ where: { id: assetId } });
            if (!asset) throw new Error(`Không tìm thấy ảnh đã chọn (id=${assetId})`);
            if (String(asset.userId) !== String(userId)) {
                throw new Error("Không có quyền dùng ảnh này");
            }
            return asset;
        }
        if (!file) return null;

        const upload = await this.cloudinaryVideoAiService.uploadBuffer(
            file.buffer, folder, `${publicIdPrefix}_${Date.now()}`,
        );

        return this.assetRepository.save(
            this.assetRepository.create({
                userId,
                assetType: "image",
                sourceType: "uploaded",
                originalUrl: upload.secure_url,
                storedUrl: upload.secure_url,
                storageProvider: "cloudinary",
                mimeType: file.mimetype,
                fileSizeBytes: file.size,
                width: upload.width,
                height: upload.height,
                metadata: { cloudinary_public_id: upload.public_id },
            }),
        );
    }

    private async resolveMultipleImageAssets(
        userId: string,
        assetIds: number[] | undefined,
        files: Express.Multer.File[] | undefined,
        folder: string,
    ): Promise<Assets[]> {
        const result: Assets[] = [];

        for (const id of assetIds ?? []) {
            const asset = await this.assetRepository.findOne({ where: { id } });
            if (!asset) throw new Error(`Không tìm thấy ảnh tham chiếu đã chọn (id=${id})`);
            if (String(asset.userId) !== String(userId)) {
                throw new Error("Không có quyền dùng ảnh này");
            }
            result.push(asset);
        }

        for (const file of files ?? []) {
            const upload = await this.cloudinaryVideoAiService.uploadBuffer(
                file.buffer, folder, `refer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            );
            const asset = await this.assetRepository.save(
                this.assetRepository.create({
                    userId,
                    assetType: "image",
                    sourceType: "uploaded",
                    originalUrl: upload.secure_url,
                    storedUrl: upload.secure_url,
                    storageProvider: "cloudinary",
                    mimeType: file.mimetype,
                    fileSizeBytes: file.size,
                    width: upload.width,
                    height: upload.height,
                    metadata: { cloudinary_public_id: upload.public_id },
                }),
            );
            result.push(asset);
        }

        return result;
    }

    private async resolveVideoAsset(
        userId: string,
        assetId: number | undefined,
        file: Express.Multer.File | undefined,
        folder: string,
    ): Promise<Assets | null> {
        if (assetId) {
            const asset = await this.assetRepository.findOne({ where: { id: assetId } });
            if (!asset) throw new Error(`Không tìm thấy video đã chọn (id=${assetId})`);
            if (String(asset.userId) !== String(userId)) {
                throw new Error("Không có quyền dùng video này");
            }
            return asset;
        }
        if (!file) return null;

        const upload = await this.cloudinaryVideoAiService.uploadVideoBuffer(
            file.buffer, folder, `video_${Date.now()}`,
        );

        return this.assetRepository.save(
            this.assetRepository.create({
                userId,
                assetType: "video",
                sourceType: "uploaded",
                originalUrl: upload.secure_url,
                storedUrl: upload.secure_url,
                thumbnailUrl: upload.thumbnail_url,
                storageProvider: "cloudinary",
                mimeType: file.mimetype,
                fileSizeBytes: file.size,
                durationSeconds: upload.duration ? Math.round(upload.duration) : undefined,
                width: upload.width,
                height: upload.height,
                fps: upload.frame_rate ? Math.round(upload.frame_rate) : undefined,
                metadata: { cloudinary_public_id: upload.public_id },
            }),
        );
    }

    async getHistory(userId: string) {
        const elements = await this.elementRepository.find({
            where: { userId },
            relations: ["provider", "images", "images.asset", "video", "video.asset"],
            order: { createdAt: "DESC" },
            take: 50,
        });

        return elements.map((el) => {
            const frontal = el.images?.find((i) => i.imageRole === "frontal");
            const refers = (el.images?.filter((i) => i.imageRole === "refer") ?? [])
                .sort((a, b) => a.sortOrder - b.sortOrder);

            return {
                id: el.id,
                status: el.status,
                elementName: el.elementName,
                elementDescription: el.elementDescription,
                referenceType: el.referenceType,
                elementVoiceId: el.elementVoiceId,
                externalElementId: el.status === "succeeded" ? el.externalElementId : null,
                providerName: el.provider?.name ?? "Unknown",
                frontalImageUrl: frontal?.asset?.storedUrl ?? null,
                referImageUrls: refers.map((r) => r.asset?.storedUrl).filter(Boolean),
                videoUrl: el.video?.asset?.storedUrl ?? null,
                errorMessage: el.errorMessage ?? null,
                isFavorite: el.isFavorite,
                createdAt: el.createdAt,
            };
        });
    }

    async getStatus(id: number) {
        const element = await this.elementRepository.findOne({
            where: { id },
            relations: ["images", "images.asset", "video", "video.asset"],
        });
        if (!element) throw new Error("Không tìm thấy element");

        const frontal = element.images?.find((i) => i.imageRole === "frontal");
        const refers = element.images?.filter((i) => i.imageRole === "refer") ?? [];

        return {
            id: element.id,
            status: element.status,
            elementName: element.elementName,
            referenceType: element.referenceType,
            externalElementId: element.status === "succeeded" ? element.externalElementId : null,
            frontalImageUrl: frontal?.asset?.storedUrl ?? null,
            referImageUrls: refers.map((r) => r.asset?.storedUrl).filter(Boolean),
            videoUrl: element.video?.asset?.storedUrl ?? null,
            errorMessage: element.errorMessage ?? null,
        };
    }

    async getKlingTaskStatus(taskId: string) {
        return this.klingService.getElementTaskStatus(taskId);
    }

    async remove(userId: string, id: number) {
        const element = await this.elementRepository.findOne({ where: { id } });
        if (!element) throw new Error("Không tìm thấy element");
        if (String(element.userId) !== String(userId)) {
            throw new Error("Không có quyền xóa element này");
        }

        if (element.status === "succeeded" && element.externalElementId) {
            try {
                await this.klingService.deleteElement(element.externalElementId);
            } catch (err: any) {
                console.warn(`[AiElement ${id}] Xóa trên Kling thất bại: ${err.message} — vẫn xóa record nội bộ`);
            }
        }

        await this.elementRepository.delete(id); // ai_element_images/ai_element_videos tự xóa theo CASCADE (FK)
        return { message: "Đã xóa element" };
    }

    async setFavorite(userId: string, id: number, isFavorite: boolean) {
        const element = await this.elementRepository.findOne({ where: { id } });
        if (!element) throw new Error("Không tìm thấy element");
        if (String(element.userId) !== String(userId)) {
            throw new Error("Không có quyền với element này");
        }
        element.isFavorite = isFavorite;
        return this.elementRepository.save(element);
    }
}