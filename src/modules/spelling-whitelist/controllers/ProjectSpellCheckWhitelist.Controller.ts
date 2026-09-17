import { Response } from "express";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { ProjectSpellCheckWhitelistService } from "../services/ProjectSpellCheckWhitelist.Service";

export class ProjectSpellCheckWhitelistController {
    private service = new ProjectSpellCheckWhitelistService();

    list = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.service.getWords(req.params.projectId as string, req.user as any);
            res.status(200).json({ items: result });
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    add = async (req: AuthRequest, res: Response) => {
        try {
            const { word, words } = req.body;
            const result = Array.isArray(words)
                ? await this.service.addWords(req.params.projectId as string, words, req.user as any)
                : [await this.service.addWord(req.params.projectId as string, word || "", req.user as any)];
            res.status(201).json({ items: result });
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    remove = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.service.removeWord(
                req.params.projectId as string,
                req.params.whitelistId as string,
                req.user as any
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };
}
