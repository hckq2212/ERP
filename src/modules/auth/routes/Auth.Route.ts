import { Router } from "express";
import { AuthController } from "../controllers/Auth.Controller";
import { authMiddleware } from "../../../shared/middlewares/Auth.Middleware";
import { authLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();
const authController = new AuthController();

router.post("/register", authLimiter, authController.register);
router.post("/login", authLimiter, authController.login);
router.post("/refresh", authLimiter, authController.refresh);
router.post("/logout", authLimiter, authController.logout);

export default router;
