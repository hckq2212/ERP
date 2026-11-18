import { Router } from "express";
import { AuthController } from "../controllers/Auth.Controller";
import { authMiddleware } from "../../../shared/middlewares/Auth.Middleware";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { authLimiter, loginLimiter, refreshLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();
const authController = new AuthController();

// Đăng ký tài khoản nội bộ chỉ dành cho Quản trị viên (BOD / ADMIN)
router.post("/register", authLimiter, authMiddleware, roleMiddleware(["BOD", "ADMIN"]), authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authLimiter, authController.logout);

export default router;
