import { Request, Response } from "express";
import { CustomerService } from "../services/Customer.Service";

export class CustomerController {
    private customerService = new CustomerService();

    getAll = async (req: Request, res: Response) => {
        try {
            const customers = await this.customerService.getAll();
            res.status(200).json(customers);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const customer = await this.customerService.getOne(Number(req.params.id));
            res.status(200).json(customer);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const customer = await this.customerService.create(req.body);
            res.status(201).json(customer);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const customer = await this.customerService.update(Number(req.params.id), req.body);
            res.status(200).json(customer);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const result = await this.customerService.delete(Number(req.params.id));
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
