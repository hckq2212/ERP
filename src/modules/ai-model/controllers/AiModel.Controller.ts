import { Request, Response } from "express";
import { AiModelService } from "../services/AiModel.Service";

export class AiModelController {
    private aiModelService = new AiModelService();

    getAll = async (req: Request, res: Response) => {
        try {
            const { providerCode, modelType, isActive, supportsMotionControl, supportsElements } = req.query;
            const result = await this.aiModelService.getAll({
                providerCode: providerCode as string,
                modelType: modelType as string,
                isActive: isActive !== undefined ? isActive === "true" : undefined,
                supportsMotionControl: supportsMotionControl !== undefined ? supportsMotionControl === "true" : undefined,
                supportsElements: supportsElements !== undefined ? supportsElements === "true" : undefined
            });
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getByProvider = async (req: Request, res: Response) => {
        try {
            const providerCode = req.params.providerCode as string;
            const result = await this.aiModelService.getByProviderCode(providerCode);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.aiModelService.getOne(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.aiModelService.create(req.body);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.aiModelService.update(id, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.aiModelService.delete(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}