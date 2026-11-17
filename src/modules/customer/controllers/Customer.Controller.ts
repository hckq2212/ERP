import { Request, Response } from "express";
import { CustomerService } from "../services/Customer.Service";
import { TaxLookupService } from "../services/TaxLookup.Service";

export class CustomerController {
    private customerService = new CustomerService();
    private taxLookupService = new TaxLookupService();

    getAll = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const filters = req.query;
            const customers = await this.customerService.getAll(userInfo, filters);
            res.status(200).json(customers);
        } catch (error: any) {
            if (error.message === "FORBIDDEN_ACCESS") {
                res.status(403).json({ message: "Bạn không có quyền truy cập danh sách khách hàng" });
            } else {
                res.status(500).json({ message: error.message });
            }
        }
    }

    getOne = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const customer = await this.customerService.getOne(req.params.id as string, userInfo);
            res.status(200).json(customer);
        } catch (error: any) {
            if (error.message === "FORBIDDEN_ACCESS" || error.message.includes("không có quyền xem")) {
                res.status(403).json({ message: error.message });
            } else {
                res.status(404).json({ message: error.message });
            }
        }
    }

    create = async (req: Request, res: Response) => {
        try {
            const customer = await this.customerService.create(req.body, (req as any).user);

            res.status(201).json(customer);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const customer = await this.customerService.update(req.params.id as string, req.body, userInfo);
            res.status(200).json(customer);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            const userInfo = (req as any).user;
            const result = await this.customerService.delete(req.params.id as string, userInfo);
            res.status(200).json(result);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    lookupTax = async (req: Request, res: Response) => {
        try {
            const taxId = req.params.taxId as string;
            const data = await this.taxLookupService.lookup(taxId);
            if (!data) {
                res.status(404).json({
                    success: false,
                    message: "Không tìm thấy thông tin doanh nghiệp theo mã số thuế này",
                    data: null
                });
                return;
            }
            res.status(200).json({
                success: true,
                data
            });
        } catch (error: any) {
            res.status(400).json({
                success: false,
                message: error.message || "Lỗi tra cứu mã số thuế",
                data: null
            });
        }
    }
}
