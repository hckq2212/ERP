import { AppDataSource } from "../../../data-source";
import { Assets } from "../entities/Asset.entity";
import { VideoGenerations } from "../../video-generation/entities/VideoGeneration.entity";
import { MotionGenerations } from "../../video-generation/entities/MotionGeneration.entity";
import { CloudinaryVideoAiService } from "../../cloudinary/services/CloudinaryVideoAi.Service";

const TAB_TO_SOURCE_TYPE: Record<string, string> = {
    creative: "generated",
    upload: "uploaded",
};

const LIBRARY_ASSET_TYPES = ["image", "video", "audio"];

export class AssetService {
    private assetRepository = AppDataSource.getRepository(Assets);
    private videoGenRepository = AppDataSource.getRepository(VideoGenerations);
    private motionGenRepository = AppDataSource.getRepository(MotionGenerations);
    private cloudinaryVideoAiService = new CloudinaryVideoAiService();

    async getOne(id: number, userId: string) {
        const asset = await this.assetRepository.findOne({ where: { id } });
        if (!asset) throw new Error("Không tìm thấy asset");
        if (String(asset.userId) !== String(userId)) {
            throw new Error("Không có quyền truy cập asset này");
        }
        return asset;
    }

    /**
     * Upload chung vào "thư viện" cá nhân của user, không gắn với bất kỳ
     * video-generation nào cụ thể (khác resolveImageAsset — dùng riêng khi
     * tạo video-gen). Dùng cho asset picker / thư viện media.
     */
    async uploadToLibrary(userId: string, file: Express.Multer.File) {
        const isVideo = file.mimetype.startsWith("video/");
        const isImage = file.mimetype.startsWith("image/");
        if (!isVideo && !isImage) {
            throw new Error("Chỉ hỗ trợ upload ảnh hoặc video");
        }

        const folder = `ai-generation/users/${userId}/library/${isVideo ? "videos" : "images"}`;
        const publicId = `${isVideo ? "video" : "image"}_${Date.now()}`;

        let storedUrl: string;
        let durationSeconds: number | undefined;
        let fps: number | undefined;
        let width: number | undefined;
        let height: number | undefined;
        let thumbnailUrl: string | undefined;

        if (isVideo) {
            const result = await this.cloudinaryVideoAiService.uploadVideoBuffer(file.buffer, folder, publicId);
            storedUrl = result.secure_url;
            durationSeconds = result.duration ? Math.round(result.duration) : undefined;
            fps = result.frame_rate ? Math.round(result.frame_rate) : undefined;
            width = result.width;
            height = result.height;
            thumbnailUrl = result.thumbnail_url;
        } else {
            const result = await this.cloudinaryVideoAiService.uploadBuffer(file.buffer, folder, publicId);
            storedUrl = result.secure_url;
            width = result.width;
            height = result.height;
        }

        const asset = this.assetRepository.create({
            userId,
            assetType: isVideo ? "video" : "image",
            sourceType: "uploaded",
            storedUrl,
            originalUrl: storedUrl,
            storageProvider: "cloudinary",
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            durationSeconds,
            fps,
            width,
            height,
            thumbnailUrl,
            metadata: {},
        });

        return await this.assetRepository.save(asset);
    }

    /**
     * Thư viện asset của user, chia theo tab:
     * - 'creative' (sourceType='generated'): kết quả AI tạo ra, được enrich
     *   thêm prompt/model/mode/frames/thumbnail từ video_generations hoặc
     *   motion_generations tương ứng (join theo outputAssetId).
     * - 'upload' (sourceType='uploaded'): asset user tự upload.
     */
    async findLibrary(
        userId: string,
        opts: { tab: string; type: string; favoritesOnly: boolean },
    ) {
        const sourceType = TAB_TO_SOURCE_TYPE[opts.tab] ?? "generated";

        const qb = this.assetRepository
            .createQueryBuilder("asset")
            .where("asset.user_id = :userId", { userId })
            .andWhere("asset.source_type = :sourceType", { sourceType })
            .andWhere("asset.asset_type IN (:...allowedTypes)", { allowedTypes: LIBRARY_ASSET_TYPES });

        if (opts.type !== "all") {
            qb.andWhere("asset.asset_type = :assetType", { assetType: opts.type });
        }
        if (opts.favoritesOnly) {
            qb.andWhere("asset.is_favorite = true");
        }

        qb.orderBy("asset.created_at", "DESC");

        const items = await qb.getMany();

        if (opts.tab === "creative") {
            const videoAssetIds = items
                .filter((i) => i.assetType === "video")
                .map((i) => i.id);

            if (videoAssetIds.length > 0) {
                const generations = await this.videoGenRepository
                    .createQueryBuilder("vg")
                    .leftJoinAndSelect("vg.model", "model")
                    .leftJoinAndSelect("vg.imageBeginAsset", "beginAsset")
                    .leftJoinAndSelect("vg.imageEndAsset", "endAsset")
                    .where("vg.output_asset_id IN (:...ids)", { ids: videoAssetIds })
                    .getMany();

                const byOutputAssetId = new Map(generations.map((g) => [g.outputAssetId, g]));

                const motionGenerations = await this.motionGenRepository
                    .createQueryBuilder("mg")
                    .leftJoinAndSelect("mg.model", "model")
                    .leftJoinAndSelect("mg.thumbnailAsset", "thumbnailAsset")
                    .leftJoinAndSelect("mg.characterImageAsset", "characterImageAsset")
                    .where("mg.output_asset_id IN (:...ids)", { ids: videoAssetIds })
                    .getMany();

                const motionByOutputAssetId = new Map(motionGenerations.map((g) => [g.outputAssetId, g]));

                for (const item of items as any[]) {
                    const gen = byOutputAssetId.get(item.id);
                    if (gen) {
                        item.prompt = gen.motionPrompt;
                        item.model = gen.model?.name ?? null;
                        item.mode = gen.generationMode;
                        item.frames = [gen.imageBeginAsset?.storedUrl, gen.imageEndAsset?.storedUrl].filter(Boolean);
                        item.thumbnailUrl = gen.imageBeginAsset?.storedUrl ?? null;
                        continue;
                    }

                    const motionGen = motionByOutputAssetId.get(item.id);
                    if (motionGen) {
                        item.prompt = motionGen.motionPrompt;
                        item.model = motionGen.model?.name ?? null;
                        item.mode = motionGen.generationMode;
                        item.thumbnailUrl =
                            motionGen.thumbnailAsset?.storedUrl ??
                            motionGen.characterImageAsset?.storedUrl ??
                            null;
                    }
                }
            }
        }

        return { items, total: items.length };
    }

    async setFavorite(userId: string, assetId: number, isFavorite: boolean) {
        const asset = await this.assetRepository.findOne({ where: { id: assetId } });
        if (!asset) throw new Error("Không tìm thấy asset");
        if (String(asset.userId) !== String(userId)) {
            throw new Error("Không có quyền với asset này");
        }
        asset.isFavorite = isFavorite;
        return await this.assetRepository.save(asset);
    }

    // ── Dùng nội bộ bởi video-generation / motion-generation ──────────────

    /**
     * Ưu tiên dùng asset ảnh có sẵn (assetId) để tránh upload trùng lên Cloudinary.
     * Chỉ upload file mới khi không có assetId. Dùng cho ảnh đầu/cuối/nhân vật.
     */
    async resolveImageAsset(
        userId: string,
        assetId: number | undefined,
        file: Express.Multer.File | undefined,
        baseFolder: string,
        role: string,
        assetRole: string,
    ): Promise<Assets | null> {
        if (assetId) {
            const asset = await this.assetRepository.findOne({ where: { id: assetId } });
            if (!asset) {
                throw new Error(`Không tìm thấy ảnh ${role} đã chọn (id=${assetId})`);
            }
            if (String(asset.userId) !== String(userId)) {
                throw new Error(`Không có quyền dùng ảnh ${role} này`);
            }
            return asset;
        }

        if (!file) return null;

        const upload = await this.cloudinaryVideoAiService.uploadBuffer(
            file.buffer,
            `${baseFolder}/${role}`,
            `${role}_${Date.now()}`,
        );

        const asset = this.assetRepository.create({
            userId,
            assetType: "image",
            assetRole,
            sourceType: "uploaded",
            originalUrl: upload.secure_url,
            storedUrl: upload.secure_url,
            storageProvider: "cloudinary",
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            metadata: {
                cloudinary_public_id: upload.public_id,
                width: upload.width,
                height: upload.height,
            },
        });

        return await this.assetRepository.save(asset);
    }

    /**
     * Dùng cho video tham chiếu (motion control). Nếu chưa có assetId, tạo
     * placeholder trước rồi trả về needUpload=true để caller tự upload nền
     * (tránh block response chờ upload video lớn).
     */
    async resolveVideoAsset(
        userId: string,
        projectId: string | undefined,
        assetId: number | undefined,
        file: Express.Multer.File | undefined,
    ): Promise<{ asset: Assets; needUpload: boolean }> {
        if (assetId) {
            const asset = await this.assetRepository.findOne({ where: { id: assetId } });
            if (!asset) throw new Error(`Không tìm thấy video đã chọn (id=${assetId})`);
            if (String(asset.userId) !== String(userId)) {
                throw new Error("Không có quyền dùng video này");
            }
            return { asset, needUpload: false };
        }

        if (!file) throw new Error("Cần cung cấp file video hoặc assetId");

        const placeholder = this.assetRepository.create({
            userId,
            projectId,
            assetType: "video",
            assetRole: "scene_video",
            sourceType: "uploaded",
            originalUrl: "",
            storedUrl: "",
            storageProvider: "cloudinary",
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            metadata: {},
        });

        const saved = await this.assetRepository.save(placeholder);
        return { asset: saved, needUpload: true };
    }

    async attachProjectIfMissing(assetId: number, projectId: string) {
        const asset = await this.assetRepository.findOne({ where: { id: assetId } });
        if (asset && !asset.projectId) {
            asset.projectId = projectId;
            await this.assetRepository.save(asset);
        }
    }

    async createGeneratedAsset(data: Partial<Assets>) {
        const asset = this.assetRepository.create(data);
        return await this.assetRepository.save(asset);
    }

    async updateAsset(id: number, data: Partial<Assets>) {
        await this.assetRepository.update(id, data as any);
    }
}