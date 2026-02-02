import { Request, Response, NextFunction } from "express";
import passport from "passport";

export interface AuthRequest extends Request {
    user?: {
        id: string;
        role: string;
    };
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate("jwt", { session: false }, (err: any, user: any, info: any) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.status(401).json({ message: "Không có quyền truy cập. Vui lòng đăng nhập." });
        }
        req.user = user;
        next();
    })(req, res, next);
};
