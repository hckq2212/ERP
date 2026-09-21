import { Request, Response } from "express";
import { AiDashboardService } from "../services/AiDashboard.Service";

export class AiDashboardController {
    private service = new AiDashboardService();

    getDashboard = async (req: Request, res: Response) => {
        try {
            const actor = (req as any).user;
            const month = req.query.month ? Number(req.query.month) : undefined;
            const year = req.query.year ? Number(req.query.year) : undefined;
            const result = await this.service.getDashboard(
                actor,
                req.query.userId as string | undefined,
                req.query.projectId as string | undefined,
                month,
                year,
            );
            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };
}
