import { Request, Response } from "express";
import { QuotationService } from "../services/Quotation.Service";

export class QuotationController {
    private quotationService = new QuotationService();

    getAll = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.getAll();
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.getOne(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getByOpportunity = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.getByOpportunity(req.params.opportunityId as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.update(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    approve = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.approve(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    reject = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.reject(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.delete(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    createAddendum = async (req: Request, res: Response) => {
        try {
            const result = await this.quotationService.createAddendumQuotation(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
