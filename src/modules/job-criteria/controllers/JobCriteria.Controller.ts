import { Request, Response } from "express";
import { JobCriteriaService } from "../services/JobCriteria.Service";

export class JobCriteriaController {
    private criteriaService = new JobCriteriaService();

    getByJob = async (req: Request, res: Response) => {
        try {
            const result = await this.criteriaService.getByJob(req.params.jobId as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.criteriaService.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.criteriaService.delete(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    sync = async (req: Request, res: Response) => {
        try {
            const result = await this.criteriaService.syncCriteria(req.params.jobId as string, req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
