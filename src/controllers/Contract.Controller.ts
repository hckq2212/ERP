import { Request, Response } from "express";
import { ContractService } from "../services/Contract.Service";
import { uploadToCloudinary } from "../helpers/cloudinary.helper";

export class ContractController {
    private contractService = new ContractService();

    getAll = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const filters = req.query;
            const contracts = await this.contractService.getAll(filters, userInfo);
            res.status(200).json(contracts);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const contract = await this.contractService.getOne(req.params.id as string);
            res.status(200).json(contract);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const contract = await this.contractService.create(req.body);
            res.status(201).json(contract);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.contractService.delete(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }


    uploadProposal = async (req: Request, res: Response) => {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ message: "Không tìm thấy file upload" });
            }

            const fileData = await uploadToCloudinary(file, "GETVINI/ERP/proposal");
            const contract = await this.contractService.uploadProposal(req.params.id as string, fileData);
            res.status(200).json(contract);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    approveProposal = async (req: Request, res: Response) => {
        try {
            const contract = await this.contractService.approveProposal(req.params.id as string);
            res.status(200).json(contract);
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

            const fileData = await uploadToCloudinary(file, "GETVINI/ERP/signed");
            const contract = await this.contractService.uploadSigned(req.params.id as string, fileData);
            res.status(200).json(contract);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    addMilestone = async (req: Request, res: Response) => {
        try {
            const milestone = await this.contractService.addMilestone(req.params.id as string, req.body);
            res.status(201).json(milestone);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    updateMilestone = async (req: Request, res: Response) => {
        try {
            const milestone = await this.contractService.updateMilestone(req.params.id as string, req.body);
            res.status(200).json(milestone);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    deleteMilestone = async (req: Request, res: Response) => {
        try {
            const result = await this.contractService.deleteMilestone(req.params.id as string);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
