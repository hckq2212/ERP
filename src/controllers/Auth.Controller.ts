import { Request, Response } from "express";
import { AuthService, SESSION_EXPIRED_CODE } from "../services/Auth.Service";

export class AuthController {
    private authService = new AuthService();

    private getCookieOptions(req: Request) {
        const origin = req.get("origin") ?? "";
        const forwardedProto = req.get("x-forwarded-proto") ?? "";
        const isHttpsRequest = req.secure || forwardedProto.includes("https");
        const isLocalOrigin = /localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i.test(origin);

        if (!isHttpsRequest || isLocalOrigin) {
            return { httpOnly: true, secure: false, sameSite: "lax" as const, path: "/" };
        }

        return { httpOnly: true, secure: true, sameSite: "none" as const, path: "/" };
    }

    private setAuthCookies(res: Response, result: {
        accessToken: string;
        refreshToken: string;
        accessMaxAge: number;
        refreshMaxAge: number;
    }, req: Request) {
        const options = this.getCookieOptions(req);
        res.cookie("accessToken", result.accessToken, { ...options, maxAge: result.accessMaxAge });
        res.cookie("refreshToken", result.refreshToken, { ...options, maxAge: result.refreshMaxAge });
    }

    private clearAuthCookies(res: Response, req: Request) {
        const options = this.getCookieOptions(req);
        res.clearCookie("accessToken", options);
        res.clearCookie("refreshToken", options);
    }

    register = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.register(req.body);
            res.status(201).json(result);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    login = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.login(req.body);

            this.setAuthCookies(res, result, req);

            res.status(200).json({
                message: "Đăng nhập thành công",
                user: result.user
            });
        } catch (error: any) {
            res.status(401).json({ message: error.message });
        }
    }

    logout = async (req: Request, res: Response) => {
        await this.authService.logout(req.cookies?.refreshToken);
        this.clearAuthCookies(res, req);
        res.status(200).json({ message: "Đăng xuất thành công" });
    }

    refresh = async (req: Request, res: Response) => {
        try {
            const result = await this.authService.refresh(req.cookies?.refreshToken);
            this.setAuthCookies(res, result, req);
            res.status(204).send();
        } catch {
            this.clearAuthCookies(res, req);
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
