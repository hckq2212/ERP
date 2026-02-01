import { Request, Response } from "express";
import { JobCriteriaService } from "../services/JobCriteria.Service";

export class JobCriteriaController {
    private criteriaService = new JobCriteriaService();

    getByJob = async (req: Request, res: Response) => {
        try {
            const result = await this.criteriaService.getByJob(Number(req.params.jobId));
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
            const result = await this.criteriaService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
