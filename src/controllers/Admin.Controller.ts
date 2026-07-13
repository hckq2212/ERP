import { Request, Response } from "express";
import { AdminService } from "../services/Admin.Service";

export class AdminController {
    private adminService = new AdminService();
    private getParam(value: string | string[]) {
        return Array.isArray(value) ? value[0] : value;
    }

    me = async (req: Request, res: Response) => {
        try {
            res.status(200).json(this.adminService.getMe(req as any));
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    entities = async (req: Request, res: Response) => {
        try {
            res.status(200).json(this.adminService.listEntities());
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    schema = async (req: Request, res: Response) => {
        try {
            res.status(200).json(this.adminService.getSchema(this.getParam(req.params.entityKey)));
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    listRecords = async (req: Request, res: Response) => {
        try {
            const result = await this.adminService.listRecords(this.getParam(req.params.entityKey), req.query as any, req as any);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    getRecord = async (req: Request, res: Response) => {
        try {
            const result = await this.adminService.getRecord(this.getParam(req.params.entityKey), this.getParam(req.params.id), (req as any).company);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    };

    createRecord = async (req: Request, res: Response) => {
        try {
            const result = await this.adminService.createRecord(this.getParam(req.params.entityKey), req.body);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    updateRecord = async (req: Request, res: Response) => {
        try {
            const result = await this.adminService.updateRecord(this.getParam(req.params.entityKey), this.getParam(req.params.id), req.body, (req as any).company);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    deleteRecord = async (req: Request, res: Response) => {
        try {
            const result = await this.adminService.deleteRecord(this.getParam(req.params.entityKey), this.getParam(req.params.id), (req as any).company);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };

    resetPassword = async (req: Request, res: Response) => {
        try {
            const { newPassword } = req.body;
            if (!newPassword) {
                return res.status(400).json({ message: "Vui long cung cap mat khau moi" });
            }

            await this.adminService.resetAccountPassword(this.getParam(req.params.id), newPassword, (req as any).company);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    };
}
