import { Request, Response } from "express";
import { ServicePackageService } from "../services/ServicePackage.Service";

export class ServicePackageController {
    private service = new ServicePackageService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.service.getAll();
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const result = await this.service.getOne(req.params.id as string);
            res.json(result);
        } catch (error) {
            res.status(404).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.service.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const result = await this.service.update(req.params.id as string, req.body);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.service.delete(req.params.id as string);
            res.json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
