import { Request, Response } from "express";
import { ContractService } from "../services/Contract.Service";

export class ContractController {
    private contractService = new ContractService();

    getAll = async (req: Request, res: Response) => {
        try {
            const contracts = await this.contractService.getAll();
            res.status(200).json(contracts);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const contract = await this.contractService.getOne(Number(req.params.id));
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
            const result = await this.contractService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
