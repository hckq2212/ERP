import { Request, Response } from "express";
import { AiProviderService } from "../services/AiProvider.Service";

export class AiProviderController {
    private aiProviderService = new AiProviderService();

    getAll = async (req: Request, res: Response) => {
        try {
            const { code, name, isActive } = req.query;
            const result = await this.aiProviderService.getAll({
                code: code as string,
                name: name as string,
                isActive: isActive !== undefined ? isActive === "true" : undefined
            });
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.aiProviderService.getOne(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }
}