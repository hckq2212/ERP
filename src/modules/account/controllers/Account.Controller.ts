import { Request, Response } from "express";
import { AccountService } from "../services/Account.Service";

export class AccountController {
    private accountService = new AccountService();

    index = async (req: Request, res: Response) => {
        try {
            const accounts = await this.accountService.getAllAccounts();
            res.status(200).json(accounts);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    show = async (req: Request, res: Response) => {
        try {
            const account = await this.accountService.getAccountById(req.params.id as string);
            res.status(200).json(account);
        } catch (error: any) {
            res.status(404).json({ message: error.message });
        }
    }

    update = async (req: Request, res: Response) => {
        try {
            const result = await this.accountService.updateAccount(req.params.id as string, req.body);
            res.status(200).json({
                message: "Cập nhật tài khoản thành công",
                account: result
            });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    delete = async (req: Request, res: Response) => {
        try {
            await this.accountService.softDeleteAccount(req.params.id as string);
            res.status(200).json({ message: "Xóa (vô hiệu hóa) tài khoản thành công" });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    resetPassword = async (req: Request, res: Response) => {
        try {
            const { newPassword } = req.body;
            if (!newPassword) {
                return res.status(400).json({ message: "Vui lòng cung cấp mật khẩu mới" });
            }
            await this.accountService.resetPassword(req.params.id as string, newPassword);
            res.status(200).json({ message: "Đặt lại mật khẩu thành công" });
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }
}
