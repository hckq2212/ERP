import { Request, Response } from "express";
import { OpportunityServiceService } from "../services/OpportunityService.Service";

export class OpportunityServiceController {
    private service = new OpportunityServiceService();

    getAllByOpportunity = async (req: Request, res: Response) => {
        try {
            const opportunityId = req.params.opportunityId as string;
            const result = await this.service.getAllByOpportunity(opportunityId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.service.getOne(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.service.create(req.body);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.service.update(id, req.body);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const id = req.params.id as string;
            const result = await this.service.delete(id);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}
