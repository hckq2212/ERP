import { Router } from "express";
import { ChatRoomController } from "../controllers/ChatRoom.Controller";

const router = Router();
const controller = new ChatRoomController();

router.get("/", controller.getUserRooms);
router.post("/", controller.createRoom);
router.post("/:roomId/participants", controller.addParticipants);
router.get("/:roomId/messages", controller.getRoomMessages);
router.post("/:roomId/read", controller.markRoomAsRead);

export default router;
