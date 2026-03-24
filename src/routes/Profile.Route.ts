import { Router } from "express";
import { ProfileController } from "../controllers/Profile.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const profileController = new ProfileController();

router.use(authMiddleware);

router.get("/", profileController.getMe);
router.patch("/", profileController.updateMe);

export default router;
