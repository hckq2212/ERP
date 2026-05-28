import { Router } from "express";
import { ChatRoomController } from "../controllers/ChatRoom.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const controller = new ChatRoomController();

router.use(authMiddleware);

router.get("/", controller.getUserRooms);
router.post("/", controller.createRoom);
router.post("/:roomId/participants", controller.addParticipants);
router.get("/:roomId/messages", controller.getRoomMessages);

export default router;
