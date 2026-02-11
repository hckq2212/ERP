import { Request, Response } from "express";
import { DashboardService } from "../services/Dashboard.Service";

export class DashboardController {
    private dashboardService = new DashboardService();

    getDashboardData = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            if (!userInfo) {
                return res.status(401).json({ message: "Không xác định được danh tính người dùng" });
            }

            const data = await this.dashboardService.getDashboardData(
                userInfo.id as string,
                userInfo.role
            );

            res.status(200).json(data);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }
}
