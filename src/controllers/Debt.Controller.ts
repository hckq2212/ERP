import { Request, Response } from "express";
import { DebtService } from "../services/Debt.Service";

export class DebtController {
    private debtService = new DebtService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.debtService.getAll();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const result = await this.debtService.getOne(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    createFromMilestone = async (req: Request, res: Response) => {
        try {
            const { milestoneId } = req.body;
            const result = await this.debtService.createFromMilestone(Number(milestoneId));
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.debtService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
