import { Request, Response } from "express";
import { ContractAddendumService } from "../services/ContractAddendum.Service";
import { uploadToCloudinary } from "../../../shared/helpers/cloudinary.helper";

export class ContractAddendumController {
    private service = new ContractAddendumService();


    create = async (req: Request, res: Response) => {
        try {
            const result = await this.service.create(req.body);
            res.status(201).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    addItems = async (req: Request, res: Response) => {
        try {
            const result = await this.service.addItems(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    uploadSigned = async (req: Request, res: Response) => {
        try {
            const { file } = req.body;
            if (!file) {
                return res.status(400).json({ message: "Không tìm thấy file metadata" });
            }

            const result = await this.service.uploadSigned(req.params.id as string, file);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    scaleDown = async (req: Request, res: Response) => {
        try {
            const result = await this.service.scaleDown(req.params.id as string, req.body);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    saleApprove = async (req: Request, res: Response) => {
        try {
            const result = await this.service.saleApprove(req.params.id as string, (req as any).user, req.body?.note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    saleReject = async (req: Request, res: Response) => {
        try {
            const result = await this.service.saleReject(req.params.id as string, (req as any).user, req.body?.note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    bodApprove = async (req: Request, res: Response) => {
        try {
            const result = await this.service.bodApprove(req.params.id as string, (req as any).user, req.body?.note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    bodReject = async (req: Request, res: Response) => {
        try {
            const result = await this.service.bodReject(req.params.id as string, (req as any).user, req.body?.note);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
