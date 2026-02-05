import { Router } from "express";
import { AuthController } from "../controllers/Auth.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const authController = new AuthController();

// router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/me", authMiddleware, authController.getMe);

export default router;
