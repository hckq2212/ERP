import { Response } from "express";
import { AuthRequest } from "../middlewares/Auth.Middleware";
import { ChatRoomService } from "../services/ChatRoom.Service";

export class ChatRoomController {
    getUserRooms = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const rooms = await ChatRoomService.getUserRooms(userId);
            res.status(200).json(rooms);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    createRoom = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const { isGroup, name, participantIds, recipientId } = req.body;

            if (isGroup) {
                if (!name) {
                    return res.status(400).json({ message: "Tên nhóm không được để trống" });
                }
                if (!participantIds || !Array.isArray(participantIds)) {
                    return res.status(400).json({ message: "Danh sách thành viên không hợp lệ" });
                }

                const newGroup = await ChatRoomService.createGroup(userId, name, participantIds);
                return res.status(201).json(newGroup);
            } else {
                if (!recipientId) {
                    return res.status(400).json({ message: "Thiếu thông tin người nhận" });
                }

                const dmRoom = await ChatRoomService.getOrCreateDM(userId, recipientId);
                return res.status(200).json(dmRoom);
            }
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    addParticipants = async (req: AuthRequest, res: Response) => {
        try {
            const roomId = req.params.roomId as string;
            const { participantIds } = req.body;

            if (!roomId) {
                return res.status(400).json({ message: "Mã phòng không hợp lệ" });
            }
            if (!participantIds || !Array.isArray(participantIds)) {
                return res.status(400).json({ message: "Danh sách thành viên không hợp lệ" });
            }

            const updatedParticipants = await ChatRoomService.addParticipants(roomId, participantIds);
            res.status(200).json(updatedParticipants);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    getRoomMessages = async (req: AuthRequest, res: Response) => {
        try {
            const roomId = req.params.roomId as string;
            const limit = req.query.limit ? parseInt(String(req.query.limit)) : 50;
            const cursor = req.query.cursor as string | undefined;

            if (!roomId) {
                return res.status(400).json({ message: "Mã phòng không hợp lệ" });
            }

            // Optional: verify if requester belongs to the room
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const messages = await ChatRoomService.getRoomMessages(roomId, limit, cursor);
            res.status(200).json(messages);
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    markRoomAsRead = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId;
            const roomId = req.params.roomId as string;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }
            if (!roomId) {
                return res.status(400).json({ message: "Mã phòng không hợp lệ" });
            }

            await ChatRoomService.markRoomAsRead(roomId, userId);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }
}
