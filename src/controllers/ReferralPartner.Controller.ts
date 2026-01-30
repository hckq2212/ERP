import { Request, Response } from "express";
import { ReferralPartnerService } from "../services/ReferralPartner.Service";

export class ReferralPartnerController {
    private referralPartnerService = new ReferralPartnerService();

    getAll = async (req: Request, res: Response) => {
        try {
            const partners = await this.referralPartnerService.getAll();
            res.status(200).json(partners);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const partner = await this.referralPartnerService.getOne(Number(req.params.id));
            res.status(200).json(partner);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const partner = await this.referralPartnerService.create(req.body);
            res.status(201).json(partner);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const partner = await this.referralPartnerService.update(Number(req.params.id), req.body);
            res.status(200).json(partner);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.referralPartnerService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getStatistics = async (req: Request, res: Response) => {
        try {
            const statistics = await this.referralPartnerService.getStatistics(Number(req.params.id));
            res.status(200).json(statistics);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
