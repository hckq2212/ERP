import { Router } from "express";
import { ChatController } from "../controllers/Chat.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";
import { sensitiveLimiter } from "../middlewares/RateLimit.Middleware";

const router = Router();
const chatController = new ChatController();

router.post("/", authMiddleware, sensitiveLimiter, roleMiddleware(["ADMIN"]), chatController.sendMessage);

export default router;
