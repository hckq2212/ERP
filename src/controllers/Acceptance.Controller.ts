import { Request, Response } from "express";
import { AcceptanceService } from "../services/Acceptance.Service";

export class AcceptanceController {
    private acceptanceService = new AcceptanceService();

    createRequest = async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id || req.body.userId; // Prefer token user
            if (!userId) throw new Error("Unauthorized: Missing user information");

            const result = await this.acceptanceService.createRequest({
                ...req.body,
                userId
            });
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    approveRequest = async (req: Request, res: Response) => {
        try {
            const approverId = (req as any).user?.id || req.body?.approverId;
            const feedback = req.body?.feedback;
            const result = await this.acceptanceService.approveRequest(Number(req.params.id), approverId, feedback);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    rejectRequest = async (req: Request, res: Response) => {
        try {
            const approverId = (req as any).user?.id || req.body?.approverId;
            const feedback = req.body?.feedback;
            const result = await this.acceptanceService.rejectRequest(Number(req.params.id), approverId, feedback);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getRequest = async (req: Request, res: Response) => {
        try {
            const result = await this.acceptanceService.getRequest(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getAllRequests = async (req: Request, res: Response) => {
        try {
            const result = await this.acceptanceService.getAllRequests();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    processRequest = async (req: Request, res: Response) => {
        try {
            const approverId = (req as any).user?.id || req.body?.approverId;
            const result = await this.acceptanceService.processRequest(Number(req.params.id), approverId, req.body.decisions);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
