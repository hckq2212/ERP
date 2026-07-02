import { Request, Response } from "express";
import { AuthService, SESSION_EXPIRED_CODE } from "../services/Auth.Service";
import { COMPANY_ACCESS_DENIED_MESSAGE } from "../middlewares/Tenant.Middleware";

export class AuthController {
    private authService = new AuthService();

    private setAuthCookies(res: Response, result: {
        accessToken: string;
        refreshToken: string;
        accessMaxAge: number;
        refreshMaxAge: number;
    }) {
        const options = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" };
        res.cookie("accessToken", result.accessToken, { ...options, maxAge: result.accessMaxAge });
        res.cookie("refreshToken", result.refreshToken, { ...options, maxAge: result.refreshMaxAge });
    }

    private clearAuthCookies(res: Response) {
        const options = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" };
        res.clearCookie("accessToken", options);
        res.clearCookie("refreshToken", options);
    }

    register = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.register(req.body, (req as any).company);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    login = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.login(req.body, (req as any).company);

            this.setAuthCookies(res, result);

            res.status(200).json({
                message: "Đăng nhập thành công",
                user: result.user
            });
        } catch (error: any) {
            const status = error.message === COMPANY_ACCESS_DENIED_MESSAGE ? 403 : 401;
            res.status(status).json({ message: error.message });
        }
    }

    logout = async (req: Request, res: Response) => {
        await this.authService.logout(req.cookies?.refreshToken, (req as any).company);
        this.clearAuthCookies(res);
        res.status(200).json({ message: "Đăng xuất thành công" });
    }

    refresh = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.refresh(req.cookies?.refreshToken, (req as any).company);
            this.setAuthCookies(res, result);
            res.status(204).send();
        } catch {
            this.clearAuthCookies(res);
            res.status(401).json({
                code: SESSION_EXPIRED_CODE,
                message: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại."
            });
        }
    }

    getMe = async (req: Request, res: Response) => {
        try {
            const accountId = (req as any).user.id;
            const result = await this.authService.getMe(accountId);
            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }
}
