import { Request, Response } from "express";
import { ContractAddendumService } from "../services/ContractAddendum.Service";
import { uploadToCloudinary } from "../helpers/cloudinary.helper";

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
            const file = req.file;
            if (!file) {
                return res.status(400).json({ message: "Không tìm thấy file upload" });
            }

            const fileData = await uploadToCloudinary(file, "GETVINI/ERP/addendum");
            const result = await this.service.uploadSigned(req.params.id as string, fileData);
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
}
