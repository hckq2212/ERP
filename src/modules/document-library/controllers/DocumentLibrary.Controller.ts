import { Response } from "express";
import { DocumentLibraryService } from "../services/DocumentLibrary.Service";

export class DocumentLibraryController {
    private documentLibraryService = new DocumentLibraryService();

    findDocuments = async (req: any, res: Response) => {
        try {
            const { search, category, tags, uploadedById, fromDate, toDate, sort } = req.query;
            const documents = await this.documentLibraryService.findDocuments({
                search: search as string,
                category: category as string,
                tags: tags as string,
                uploadedById: uploadedById as string,
                fromDate: fromDate as string,
                toDate: toDate as string,
                sort: sort as string,
            });
            res.status(200).json(documents);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getAllTags = async (req: any, res: Response) => {
        try {
            const tags = await this.documentLibraryService.getAllTags();
            res.status(200).json(tags);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getOne = async (req: any, res: Response) => {
        try {
            const document = await this.documentLibraryService.getOne(req.params.id);
            res.status(200).json(document);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    upload = async (req: any, res: Response) => {
        try {
            const file = req.file as Express.Multer.File | undefined;
            if (!file) {
                return res.status(400).json({ message: "File là bắt buộc" });
            }
            const { displayName, description, tags } = req.body;
            const document = await this.documentLibraryService.upload(req.user.id, file, {
                displayName,
                description,
                tags: tags ? JSON.parse(tags) : undefined,
            });
            res.status(201).json(document);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    update = async (req: any, res: Response) => {
        try {
            const document = await this.documentLibraryService.update(req.params.id, req.body);
            res.status(200).json(document);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    uploadNewVersion = async (req: any, res: Response) => {
        try {
            const file = req.file as Express.Multer.File | undefined;
            if (!file) {
                return res.status(400).json({ message: "File là bắt buộc" });
            }
            const document = await this.documentLibraryService.uploadNewVersion(req.params.id, req.user.id, file);
            res.status(200).json(document);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    getVersions = async (req: any, res: Response) => {
        try {
            const versions = await this.documentLibraryService.getVersions(req.params.id);
            res.status(200).json(versions);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    downloadVersion = async (req: any, res: Response) => {
        try {
            const result = await this.documentLibraryService.getVersionDownloadUrl(req.params.id, req.params.versionId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    restoreVersion = async (req: any, res: Response) => {
        try {
            const document = await this.documentLibraryService.restoreVersion(req.params.id, req.params.versionId, req.user.id);
            res.status(200).json(document);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    delete = async (req: any, res: Response) => {
        try {
            const result = await this.documentLibraryService.delete(req.params.id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    download = async (req: any, res: Response) => {
        try {
            const result = await this.documentLibraryService.getDownloadUrl(req.params.id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };
}
