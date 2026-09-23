import { Request, Response } from "express";
import { FinanceDocumentService } from "../services/FinanceDocument.Service";

export class FinanceDocumentController {
    private service = new FinanceDocumentService();

    getByContract = async (req: Request, res: Response) => {
        try {
            res.json(await this.service.getByContract(req.params.contractId as string, (req as any).user));
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    createAcceptanceMinute = async (req: Request, res: Response) => {
        try {
            res.status(201).json(await this.service.createAcceptanceMinute(req.body, (req as any).user));
        } catch (error: any) {
            res.status(error.statusCode || 400).json({ message: error.message });
        }
    };

    createVatInvoice = async (req: Request, res: Response) => {
        try {
            res.status(201).json(await this.service.createVatInvoice(req.body, (req as any).user));
        } catch (error: any) {
            res.status(error.statusCode || 400).json({ message: error.message });
        }
    };
}
