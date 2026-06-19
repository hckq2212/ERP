import { Request, Response } from "express";
import { AuthService } from "../services/Auth.Service";
import { COMPANY_ACCESS_DENIED_MESSAGE } from "../middlewares/Tenant.Middleware";

export class AuthController {
    private authService = new AuthService();

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

            // Set HttpOnly Cookies
            const isRememberMe = result.rememberMe;
            const accessMaxAge = isRememberMe ? 30 * 24 * 60 * 60 * 1000 : 240 * 60 * 1000;
            const refreshMaxAge = isRememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

            res.cookie("accessToken", result.accessToken, {
                httpOnly: true,
                secure: true,
                sameSite: "none",
                maxAge: accessMaxAge,
                path: "/",
            });

            res.cookie("refreshToken", result.refreshToken, {
                httpOnly: true,
                secure: true,
                sameSite: "none",
                maxAge: refreshMaxAge,
                path: "/"
            });

            res.status(200).json({
                message: "Đăng nhập thành công",
                accessToken: result.accessToken,
                user: result.user
            });
        } catch (error: any) {
            const status = error.message === COMPANY_ACCESS_DENIED_MESSAGE ? 403 : 401;
            res.status(status).json({ message: error.message });
        }
    }

    logout = async (req: Request, res: Response) => {
        res.clearCookie("accessToken");
        res.clearCookie("refreshToken");
        res.status(200).json({ message: "Đăng xuất thành công" });
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
