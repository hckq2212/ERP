import { Request, Response, NextFunction } from "express";
import passport from "passport";

export interface AuthRequest extends Request {
    user?: {
        id: string;      // Account ID
        userId?: string;  // User ID (from Users entity)
        role: string;
        username?: string;
    };
}


export const authMiddleware = (req: any, res: Response, next: NextFunction) => {
    passport.authenticate("jwt", { session: false }, (err: any, user: any, info: any) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.status(401).json({ message: "Không có quyền truy cập. Vui lòng đăng nhập." });
        }
        req.user = user;

        // Đối chiếu tính toàn vẹn: Khóa phiên ký số trên thiết bị di động phải khớp với danh tính tài khoản trong JWT
        if (req.clientIntegrity?.type === "mobile" && req.clientIntegrity.userId) {
            const tokenUserId = user.userId || user.id;
            const tokenAccountId = user.id;
            if (req.clientIntegrity.userId !== tokenUserId && req.clientIntegrity.userId !== tokenAccountId) {
                return res.status(401).json({
                    code: "INTEGRITY_USER_MISMATCH",
                    message: "Chữ ký bảo mật thiết bị không khớp với danh tính tài khoản đăng nhập."
                });
            }
        }

        next();
    })(req, res, next);
};
