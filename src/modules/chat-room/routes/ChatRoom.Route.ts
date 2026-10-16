import { Router } from "express";
import { ChatRoomController } from "../controllers/ChatRoom.Controller";

const router = Router();
const controller = new ChatRoomController();

router.get("/", controller.getUserRooms);
router.post("/", controller.createRoom);
router.post("/:roomId/participants", controller.addParticipants);
router.get("/:roomId/messages", controller.getRoomMessages);
router.post("/:roomId/messages", controller.sendMessage);
router.post("/:roomId/messages/:messageId/reaction", controller.reactToMessage);
router.post("/:roomId/messages/:messageId/pin", controller.pinMessage);
router.get("/:roomId/pinned-messages", controller.getPinnedMessages);
router.post("/:roomId/messages/:messageId/recall", controller.recallMessage);
router.put("/:roomId/messages/:messageId", controller.editMessage);
router.post("/:roomId/messages/:messageId/forward", controller.forwardMessage);
router.post("/:roomId/read", controller.markRoomAsRead);
router.patch("/:roomId", controller.updateRoom);
router.patch("/:roomId/preferences", controller.updatePreferences);
router.patch("/:roomId/participants/:targetUserId/role", controller.updateParticipantRole);
router.delete("/:roomId/participants/:targetUserId", controller.removeParticipant);

export default router;
