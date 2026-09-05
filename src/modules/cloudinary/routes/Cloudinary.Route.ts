import { Router } from "express";
import { CloudinaryController } from "../controllers/Cloudinary.Controller";
import { sensitiveLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();
const cloudinaryController = new CloudinaryController();

// All cloudinary signature requests must be authenticated
router.get("/signature", sensitiveLimiter, cloudinaryController.getSignature);

export default router;
