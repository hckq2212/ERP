import { Response } from "express";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { ChatRoomService } from "../services/ChatRoom.Service";
import { broadcastToRoom } from "../../../socket";

export class ChatRoomController {
    getUserRooms = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            if (!userId) return res.status(401).json({ message: "Unauthorized" });

            const rooms = await ChatRoomService.getUserRooms(userId);
            res.status(200).json(rooms);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    createRoom = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            if (!userId) return res.status(401).json({ message: "Unauthorized" });

            const { isGroup, name, participantIds, recipientId, avatarUrl } = req.body;
            if (isGroup) {
                if (!name) return res.status(400).json({ message: "Tên nhóm không được để trống" });
                if (!participantIds || !Array.isArray(participantIds)) {
                    return res.status(400).json({ message: "Danh sách thành viên không hợp lệ" });
                }

                const newGroup = await ChatRoomService.createGroup(userId, name, participantIds, avatarUrl);
                return res.status(201).json(newGroup);
            }

            if (!recipientId) return res.status(400).json({ message: "Thiếu thông tin người nhận" });

            const dmRoom = await ChatRoomService.getOrCreateDM(userId, recipientId);
            return res.status(200).json(dmRoom);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    addParticipants = async (req: AuthRequest, res: Response) => {
        try {
            const roomId = String(req.params.roomId || "");
            const { participantIds } = req.body;
            const userId = req.user?.userId;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });
            if (!participantIds || !Array.isArray(participantIds)) {
                return res.status(400).json({ message: "Danh sách thành viên không hợp lệ" });
            }

            const isParticipant = await ChatRoomService.isParticipant(roomId, userId);
            if (!isParticipant) return res.status(403).json({ message: "Bạn không thuộc phòng chat này" });

            const updatedParticipants = await ChatRoomService.addParticipants(roomId, participantIds, userId);
            res.status(200).json(updatedParticipants);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    getRoomMessages = async (req: AuthRequest, res: Response) => {
        try {
            const roomId = String(req.params.roomId || "");
            const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10), 100) : 50;
            const cursor = req.query.cursor as string | undefined;
            const userId = req.user?.userId;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });

            const isParticipant = await ChatRoomService.isParticipant(roomId, userId);
            if (!isParticipant) return res.status(403).json({ message: "Bạn không thuộc phòng chat này" });

            const messages = await ChatRoomService.getRoomMessages(roomId, limit, cursor);
            res.status(200).json(messages);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    sendMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const roomId = String(req.params.roomId || "");
            const { content, attachments, replyToId } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
            if (!content?.trim() && !hasAttachments) return res.status(400).json({ message: "Tin nhắn không được để trống" });

            const message = await ChatRoomService.createMessage(roomId, userId, content || "", attachments || [], replyToId);

            // Phát realtime qua socket cho tất cả thành viên (kể cả khi gửi qua REST fallback)
            if (message) {
                await broadcastToRoom(roomId, "receive_message", message);
            }

            res.status(201).json(message);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    markRoomAsRead = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const roomId = String(req.params.roomId || "");

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });

            await ChatRoomService.markRoomAsRead(roomId, userId);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    };

    updateParticipantRole = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId;
            const roomId = String(req.params.roomId || "");
            const targetUserId = String(req.params.targetUserId || "");
            const { role } = req.body;

            if (!requesterId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !targetUserId) return res.status(400).json({ message: "Thông tin không hợp lệ" });
            if (!["ADMIN", "DEPUTY", "MEMBER"].includes(role)) {
                return res.status(400).json({ message: "Vai trò không hợp lệ" });
            }

            const updatedParticipants = await ChatRoomService.updateParticipantRole(
                roomId,
                targetUserId,
                role,
                requesterId
            );
            res.status(200).json(updatedParticipants);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    removeParticipant = async (req: AuthRequest, res: Response) => {
        try {
            const requesterId = req.user?.userId;
            const roomId = String(req.params.roomId || "");
            const targetUserId = String(req.params.targetUserId || "");

            if (!requesterId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !targetUserId) return res.status(400).json({ message: "Thông tin không hợp lệ" });

            const remainingParticipants = await ChatRoomService.removeParticipant(
                roomId,
                targetUserId,
                requesterId
            );
            res.status(200).json(remainingParticipants);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    updateRoom = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const { name, avatarUrl } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });

            const updatedRoom = await ChatRoomService.updateRoom(roomId, userId, { name, avatarUrl });
            res.status(200).json(updatedRoom);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    updatePreferences = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const { isPinned, isMuted } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });

            const updated = await ChatRoomService.updateParticipantPreferences(roomId, userId, {
                isPinned,
                isMuted
            });
            res.status(200).json(updated);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    reactToMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const messageId = String(req.params.messageId || "");
            const { emoji } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !messageId || !emoji) return res.status(400).json({ message: "Thông tin không hợp lệ" });

            const result = await ChatRoomService.reactToMessage(roomId, messageId, userId, emoji);
            await broadcastToRoom(roomId, "message_reaction", result);

            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    pinMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const messageId = String(req.params.messageId || "");
            const { isPinned } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !messageId) return res.status(400).json({ message: "Thông tin không hợp lệ" });

            const result = await ChatRoomService.pinMessage(roomId, messageId, userId, isPinned !== false);
            await broadcastToRoom(roomId, "message_pinned", result);

            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    getPinnedMessages = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId) return res.status(400).json({ message: "Mã phòng không hợp lệ" });

            const pinnedMessages = await ChatRoomService.getPinnedMessages(roomId, userId);
            res.status(200).json(pinnedMessages);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    recallMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const messageId = String(req.params.messageId || "");

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !messageId) return res.status(400).json({ message: "Thông tin không hợp lệ" });

            const result = await ChatRoomService.recallMessage(roomId, messageId, userId);
            await broadcastToRoom(roomId, "message_recalled", result);

            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    editMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const messageId = String(req.params.messageId || "");
            const { content } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !messageId) return res.status(400).json({ message: "Thông tin không hợp lệ" });

            const result = await ChatRoomService.editMessage(roomId, messageId, userId, content);
            await broadcastToRoom(roomId, "message_edited", result);

            res.status(200).json(result);
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };

    forwardMessage = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            const roomId = String(req.params.roomId || "");
            const messageId = String(req.params.messageId || "");
            const { targetRoomIds } = req.body;

            if (!userId) return res.status(401).json({ message: "Unauthorized" });
            if (!roomId || !messageId || !Array.isArray(targetRoomIds) || targetRoomIds.length === 0) {
                return res.status(400).json({ message: "Vui lòng chọn ít nhất một phòng chat nhận" });
            }

            const createdMessages = await ChatRoomService.forwardMessage(roomId, messageId, targetRoomIds, userId);
            for (const msg of createdMessages) {
                await broadcastToRoom(msg.roomId, "receive_message", msg);
            }

            res.status(200).json({ success: true, count: createdMessages.length, messages: createdMessages });
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ message: error.message });
        }
    };
}
