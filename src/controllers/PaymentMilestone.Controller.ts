import { Request, Response } from "express";
import { PaymentMilestoneService } from "../services/PaymentMilestone.Service";

export class PaymentMilestoneController {
    private service = new PaymentMilestoneService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.service.getAll();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getByContract = async (req: Request, res: Response) => {
        try {
            const result = await this.service.getByContract(Number(req.params.contractId));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
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
            const result = await this.service.update(Number(req.params.id), req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.service.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    bulkSave = async (req: Request, res: Response) => {
        try {
            const result = await this.service.bulkSave(Number(req.params.contractId), req.body.milestones);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
