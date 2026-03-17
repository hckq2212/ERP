import { Response } from "express";
import { ChatService } from "../services/Chat.Service";
import { AuthRequest } from "../middlewares/Auth.Middleware";

export class ChatController {
    sendMessage = async (req: AuthRequest, res: Response) => {
        try {
            const { message, sessionId } = req.body;
            const user = req.user;

            if (!message) {
                return res.status(400).json({ message: "Tin nhắn không được để trống" });
            }

            if (!user) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const token = req.cookies?.accessToken || req.headers.authorization?.split(" ")[1];

            const result = await ChatService.sendMessage(
                message, 
                user.id, 
                user.username || "User",
                token,
                sessionId
            );

            res.status(200).json(result);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }
}
