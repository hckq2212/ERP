import { Request, Response } from "express";
import { PaymentDashboardService } from "../services/PaymentDashboard.Service";

export class PaymentDashboardController {
    private service = new PaymentDashboardService();

    getDashboard = async (req: Request, res: Response) => {
        try {
            const data = await this.service.getDashboard({
                ...req.query,
                year: req.query.year ? Number(req.query.year) : undefined,
                page: req.query.page ? Number(req.query.page) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined
            }, (req as any).user);
            res.status(200).json(data);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };
}
