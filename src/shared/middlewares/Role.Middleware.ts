import { Response, NextFunction } from "express";
import { AuthRequest } from "./Auth.Middleware";

export const roleMiddleware = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: "Không có quyền truy cập. Vui lòng đăng nhập." });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Bạn không có quyền thực hiện hành động này. Cần quyền: ${allowedRoles.join(" hoặc ")}`
            });
        }

        next();
    };
};
