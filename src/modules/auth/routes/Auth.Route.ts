import { Router } from "express";
import { AuthController } from "../controllers/Auth.Controller";
import { authMiddleware } from "../../../shared/middlewares/Auth.Middleware";
import { authLimiter, loginLimiter, refreshLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();
const authController = new AuthController();

router.post("/register", authLimiter, authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", authLimiter, authController.logout);

export default router;
