import { Router } from "express";
import { CloudinaryController } from "../controllers/Cloudinary.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { sensitiveLimiter } from "../middlewares/RateLimit.Middleware";

const router = Router();
const cloudinaryController = new CloudinaryController();

// All cloudinary signature requests must be authenticated
router.get("/signature", authMiddleware, sensitiveLimiter, cloudinaryController.getSignature);

export default router;
