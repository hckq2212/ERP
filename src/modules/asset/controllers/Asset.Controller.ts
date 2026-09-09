import { Response } from "express";
import { AssetService } from "../services/Asset.Service";

export class AssetController {
    private assetService = new AssetService();

    upload = async (req: any, res: Response) => {
        try {
            const file = req.file as Express.Multer.File | undefined;
            if (!file) {
                return res.status(400).json({ message: "File là bắt buộc" });
            }
            const result = await this.assetService.uploadToLibrary(req.user.id, file);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    findLibrary = async (req: any, res: Response) => {
        try {
            const tab = (req.query.tab as string) || "creative";
            const type = (req.query.type as string) || "all";
            const favorite = req.query.favorite as string | undefined;

            const result = await this.assetService.findLibrary(req.user.id, {
                tab,
                type,
                favoritesOnly: favorite === "true",
            });
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getOne = async (req: any, res: Response) => {
        try {
            const id = Number(req.params.id);
            const result = await this.assetService.getOne(id, req.user.id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    toggleFavorite = async (req: any, res: Response) => {
        try {
            const id = Number(req.params.id);
            const isFavorite = !!req.body.isFavorite;
            const result = await this.assetService.setFavorite(req.user.id, id, isFavorite);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };
}