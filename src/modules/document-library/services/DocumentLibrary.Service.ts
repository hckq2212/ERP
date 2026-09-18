import { AppDataSource } from "../../../data-source";
import { Documents } from "../entities/Document.entity";
import { DocumentVersions } from "../entities/DocumentVersion.entity";
import { uploadToCloudinary, generateDownloadUrl } from "../../../shared/helpers/cloudinary.helper";
import cloudinary from "../../../shared/config/cloudinary";
import { ILike, Between, LessThanOrEqual, MoreThanOrEqual } from "typeorm";

const resolveResourceType = (mimeType?: string) => {
    if (!mimeType) return "raw";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return "raw";
};

const CATEGORY_EXTENSIONS: Record<string, string[]> = {
    document: ["doc", "docx", "txt", "rtf"],
    spreadsheet: ["xlsx", "xls", "csv"],
    presentation: ["ppt", "pptx"],
    pdf: ["pdf"],
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
    video: ["mp4", "mov", "avi", "webm"],
    archive: ["zip", "rar", "7z"],
};

const resolveCategory = (extension?: string) => {
    const ext = (extension || "").toLowerCase();
    for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
        if (extensions.includes(ext)) return category;
    }
    return "other";
};

const SORT_MAP: Record<string, any> = {
    newest: { createdAt: "DESC" },
    oldest: { createdAt: "ASC" },
    displayName: { displayName: "ASC" },
    mostDownloaded: { downloadCount: "DESC" },
};

export class DocumentLibraryService {
    private documentRepository = AppDataSource.getRepository(Documents);
    private versionRepository = AppDataSource.getRepository(DocumentVersions);

    async findDocuments(query: {
        search?: string;
        category?: string;
        tags?: string;
        uploadedById?: string;
        fromDate?: string;
        toDate?: string;
        sort?: string;
    }) {
        const where: any = {};

        if (query.search) {
            where.displayName = ILike(`%${query.search}%`);
        }

        if (query.uploadedById) {
            where.uploadedById = query.uploadedById;
        }

        if (query.fromDate && query.toDate) {
            where.createdAt = Between(new Date(query.fromDate), new Date(query.toDate));
        } else if (query.fromDate) {
            where.createdAt = MoreThanOrEqual(new Date(query.fromDate));
        } else if (query.toDate) {
            where.createdAt = LessThanOrEqual(new Date(query.toDate));
        }

        let documents = await this.documentRepository.find({
            where,
            relations: ["uploadedBy"],
            order: SORT_MAP[query.sort || "newest"],
        });

        if (query.category && query.category !== "all") {
            documents = documents.filter((doc) => resolveCategory(doc.fileExtension) === query.category);
        }

        if (query.tags) {
            const selectedTags = query.tags.split(",").map((t) => t.trim()).filter(Boolean);
            if (selectedTags.length > 0) {
                documents = documents.filter((doc) => doc.tags?.some((t) => selectedTags.includes(t)));
            }
        }

        return documents.map((doc) => ({ ...doc, category: resolveCategory(doc.fileExtension) }));
    }

    async getAllTags() {
        const documents = await this.documentRepository.find({ select: ["tags"] });
        const tagSet = new Set<string>();
        for (const doc of documents) {
            for (const tag of doc.tags || []) {
                tagSet.add(tag);
            }
        }
        return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
    }

    async getOne(id: string) {
        const document = await this.documentRepository.findOne({
            where: { id },
            relations: ["uploadedBy"],
        });
        if (!document) throw new Error("Không tìm thấy tài liệu");
        return document;
    }

    async upload(
        userId: string,
        file: Express.Multer.File,
        data: { displayName?: string; description?: string; tags?: string[] }
    ) {
        if (!data.displayName || !data.displayName.trim()) {
            throw new Error("Tên hiển thị không được để trống");
        }

        const uploaded = await uploadToCloudinary(file, "ERP/document-library");

        const document = this.documentRepository.create({
            displayName: data.displayName.trim(),
            description: data.description,
            fileUrl: uploaded.url,
            publicId: uploaded.publicId,
            originalFileName: file.originalname,
            fileExtension: uploaded.extension,
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            resourceType: resolveResourceType(file.mimetype),
            currentVersion: 1,
            tags: data.tags || [],
            uploadedById: userId,
        });

        const saved = await this.documentRepository.save(document);

        const version = this.versionRepository.create({
            documentId: saved.id,
            versionNumber: 1,
            fileUrl: saved.fileUrl,
            publicId: saved.publicId,
            originalFileName: saved.originalFileName,
            fileExtension: saved.fileExtension,
            mimeType: saved.mimeType,
            fileSizeBytes: saved.fileSizeBytes,
            resourceType: saved.resourceType,
            uploadedById: userId,
        });
        await this.versionRepository.save(version);

        return saved;
    }

    async update(id: string, data: { displayName?: string; description?: string; tags?: string[] }) {
        const document = await this.getOne(id);
        Object.assign(document, data);
        return await this.documentRepository.save(document);
    }

    async uploadNewVersion(id: string, userId: string, file: Express.Multer.File) {
        const document = await this.getOne(id);
        const uploaded = await uploadToCloudinary(file, "ERP/document-library");
        const nextVersion = (document.currentVersion || 1) + 1;

        const version = this.versionRepository.create({
            documentId: document.id,
            versionNumber: nextVersion,
            fileUrl: uploaded.url,
            publicId: uploaded.publicId,
            originalFileName: file.originalname,
            fileExtension: uploaded.extension,
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            resourceType: resolveResourceType(file.mimetype),
            uploadedById: userId,
        });
        await this.versionRepository.save(version);

        document.fileUrl = uploaded.url;
        document.publicId = uploaded.publicId;
        document.originalFileName = file.originalname;
        document.fileExtension = uploaded.extension;
        document.mimeType = file.mimetype;
        document.fileSizeBytes = file.size;
        document.resourceType = resolveResourceType(file.mimetype);
        document.currentVersion = nextVersion;

        return await this.documentRepository.save(document);
    }

    async getVersions(id: string) {
        await this.getOne(id);
        return await this.versionRepository.find({
            where: { documentId: id },
            relations: ["uploadedBy"],
            order: { versionNumber: "DESC" },
        });
    }

    async getVersionDownloadUrl(id: string, versionId: string) {
        await this.getOne(id);
        const version = await this.versionRepository.findOne({ where: { id: versionId, documentId: id } });
        if (!version) throw new Error("Không tìm thấy phiên bản");
        return {
            downloadUrl: generateDownloadUrl(version.publicId, version.resourceType, version.originalFileName),
        };
    }

    async restoreVersion(id: string, versionId: string, userId: string) {
        const document = await this.getOne(id);
        const version = await this.versionRepository.findOne({ where: { id: versionId, documentId: id } });
        if (!version) throw new Error("Không tìm thấy phiên bản");
        const nextVersion = (document.currentVersion || 1) + 1;

        const newVersion = this.versionRepository.create({
            documentId: document.id,
            versionNumber: nextVersion,
            fileUrl: version.fileUrl,
            publicId: version.publicId,
            originalFileName: version.originalFileName,
            fileExtension: version.fileExtension,
            mimeType: version.mimeType,
            fileSizeBytes: version.fileSizeBytes,
            resourceType: version.resourceType,
            uploadedById: userId,
        });
        await this.versionRepository.save(newVersion);

        document.fileUrl = version.fileUrl;
        document.publicId = version.publicId;
        document.originalFileName = version.originalFileName;
        document.fileExtension = version.fileExtension;
        document.mimeType = version.mimeType;
        document.fileSizeBytes = version.fileSizeBytes;
        document.resourceType = version.resourceType;
        document.currentVersion = nextVersion;

        return await this.documentRepository.save(document);
    }

    async delete(id: string) {
        const document = await this.getOne(id);
        const versions = await this.versionRepository.find({ where: { documentId: id } });
        for (const version of versions) {
            try {
                await cloudinary.uploader.destroy(version.publicId, { resource_type: version.resourceType });
            } catch (error) {}
        }
        await this.versionRepository.delete({ documentId: id });
        await this.documentRepository.remove(document);
        return { message: "Xóa tài liệu thành công" };
    }

    async getDownloadUrl(id: string) {
        const document = await this.getOne(id);
        document.downloadCount = (document.downloadCount || 0) + 1;
        await this.documentRepository.save(document);
        return {
            downloadUrl: generateDownloadUrl(document.publicId, document.resourceType, document.originalFileName),
        };
    }
}
