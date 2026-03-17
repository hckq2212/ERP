import { Router } from "express";
import { ChatController } from "../controllers/Chat.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const chatController = new ChatController();

router.post("/", authMiddleware, chatController.sendMessage);

export default router;
