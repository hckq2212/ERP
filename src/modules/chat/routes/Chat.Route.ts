import { Router } from "express";
import { ChatController } from "../controllers/Chat.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { sensitiveLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();
const chatController = new ChatController();

router.post("/", sensitiveLimiter, roleMiddleware(["ADMIN"]), chatController.sendMessage);

export default router;
