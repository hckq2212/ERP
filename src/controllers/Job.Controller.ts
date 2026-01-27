import { Request, Response } from "express";
import { JobService } from "../services/Job.Service";

export class JobController {
    private jobService = new JobService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.jobService.getAll();
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const result = await this.jobService.getOne(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.jobService.create(req.body);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const result = await this.jobService.update(id, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id as string);
            const result = await this.jobService.delete(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}
