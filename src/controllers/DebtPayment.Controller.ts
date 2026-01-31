import { Request, Response } from "express";
import { DebtPaymentService } from "../services/DebtPayment.Service";

export class DebtPaymentController {
    private paymentService = new DebtPaymentService();

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.paymentService.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.paymentService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
