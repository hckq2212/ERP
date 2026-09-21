import { Response } from "express";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { QcService } from "../services/Qc.Service";

export class QcController {
    private service = new QcService();

    productInfo = async (req: AuthRequest, res: Response) => {
        try {
            const projectId = req.params.projectId as string;
            const result = await this.service.getApprovedProductInfo(
                projectId,
                req.user as unknown as { id: string; userId?: string; role: string }
            );
            res.status(200).json({ items: result });
        } catch (error: any) {
            res.status(error.statusCode || error.response?.status || 500).json({ message: error.response?.data?.detail || error.message });
        }
    };
}
