import { AppDataSource } from "../data-source";
import { ChatRooms } from "../entity/ChatRoom.entity";
import { ChatParticipants } from "../entity/ChatParticipant.entity";
import { ChatMessages } from "../entity/ChatMessage.entity";
import { Users } from "../entity/User.entity";
import { In, LessThan } from "typeorm";

export class ChatRoomService {
    static async getUserRooms(userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        // Find all rooms this user is in
        const userParticipations = await participantRepo.find({
            where: { userId },
            select: ["roomId"]
        });

        if (userParticipations.length === 0) return [];

        const roomIds = userParticipations.map(p => p.roomId);

        // Fetch these rooms along with all participants populated with user details
        const rooms = await roomRepo.find({
            where: { id: In(roomIds) },
            order: { updatedAt: "DESC" }
        });

        const enrichedRooms = await Promise.all(rooms.map(async (room) => {
            // Fetch participants for this room
            const participants = await participantRepo.find({
                where: { roomId: room.id },
                relations: ["user"]
            });

            // Fetch latest message
            const messageRepo = AppDataSource.getRepository(ChatMessages);
            const latestMessage = await messageRepo.findOne({
                where: { roomId: room.id },
                order: { createdAt: "DESC" },
                relations: ["sender"]
            });

            const myParticipant = participants.find(p => p.userId === userId);
            const lastReadAt = myParticipant?.lastReadAt;

            const isUnread = latestMessage
                ? latestMessage.senderId !== userId && (!lastReadAt || new Date(latestMessage.createdAt).getTime() > new Date(lastReadAt).getTime())
                : false;

            return {
                ...room,
                participants,
                latestMessage,
                unread: isUnread
            };
        }));

        // Sort by latest message date or room update date
        return enrichedRooms.sort((a, b) => {
            const timeA = a.latestMessage?.createdAt || a.updatedAt;
            const timeB = b.latestMessage?.createdAt || b.updatedAt;
            return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
    }

    static async getOrCreateDM(userId1: string, userId2: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        // 1. Get all room IDs for user 1
        const rooms1 = await participantRepo.find({
            where: { userId: userId1 },
            select: ["roomId"]
        });

        // 2. Get all room IDs for user 2
        const rooms2 = await participantRepo.find({
            where: { userId: userId2 },
            select: ["roomId"]
        });

        const roomIds1 = rooms1.map(r => r.roomId);
        const roomIds2 = rooms2.map(r => r.roomId);

        // Intersect rooms
        const commonRoomIds = roomIds1.filter(id => roomIds2.includes(id));

        if (commonRoomIds.length > 0) {
            // Find if any of these common rooms is a 1-1 direct message room
            const existingRoom = await roomRepo.findOne({
                where: {
                    id: In(commonRoomIds),
                    isGroup: false
                }
            });

            if (existingRoom) {
                // Return existing room with participants
                const participants = await participantRepo.find({
                    where: { roomId: existingRoom.id },
                    relations: ["user"]
                });
                return { ...existingRoom, participants };
            }
        }

        // Create new DM room
        return await AppDataSource.transaction(async (transactionalEntityManager) => {
            // Create Room
            const newRoom = new ChatRooms();
            newRoom.isGroup = false;
            await transactionalEntityManager.save(newRoom);

            // Add Participant 1
            const p1 = new ChatParticipants();
            p1.roomId = newRoom.id;
            p1.userId = userId1;
            p1.lastReadAt = new Date();
            await transactionalEntityManager.save(p1);

            // Add Participant 2
            const p2 = new ChatParticipants();
            p2.roomId = newRoom.id;
            p2.userId = userId2;
            p2.lastReadAt = null;
            await transactionalEntityManager.save(p2);

            const participants = await participantRepo.find({
                where: { roomId: newRoom.id },
                relations: ["user"]
            });

            return { ...newRoom, participants };
        });
    }

    static async createGroup(creatorId: string, name: string, participantIds: string[]) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        
        return await AppDataSource.transaction(async (transactionalEntityManager) => {
            const newRoom = new ChatRooms();
            newRoom.name = name;
            newRoom.isGroup = true;
            newRoom.creatorId = creatorId;
            await transactionalEntityManager.save(newRoom);

            // Add creator
            const pCreator = new ChatParticipants();
            pCreator.roomId = newRoom.id;
            pCreator.userId = creatorId;
            pCreator.lastReadAt = new Date();
            await transactionalEntityManager.save(pCreator);

            // Add other participants
            for (const uId of participantIds) {
                if (uId !== creatorId) {
                    const p = new ChatParticipants();
                    p.roomId = newRoom.id;
                    p.userId = uId;
                    p.lastReadAt = null;
                    await transactionalEntityManager.save(p);
                }
            }

            const participants = await participantRepo.find({
                where: { roomId: newRoom.id },
                relations: ["user"]
            });

            return { ...newRoom, participants };
        });
    }

    static async addParticipants(roomId: string, userIds: string[]) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const addedParticipants: ChatParticipants[] = [];

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            for (const uId of userIds) {
                // Check if already in room
                const exists = await participantRepo.findOne({
                    where: { roomId, userId: uId }
                });

                if (!exists) {
                    const p = new ChatParticipants();
                    p.roomId = roomId;
                    p.userId = uId;
                    const saved = await transactionalEntityManager.save(p);
                    addedParticipants.push(saved);
                }
            }
        });

        // Return all participants currently in the room
        return await participantRepo.find({
            where: { roomId },
            relations: ["user"]
        });
    }

    static async getRoomMessages(roomId: string, limit = 50, cursor?: string) {
        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const where: any = { roomId };
        if (cursor) {
            where.id = LessThan(cursor);
        }
        const messages = await messageRepo.find({
            where,
            relations: ["sender"],
            order: { id: "DESC" }, // Newest first
            take: limit
        });
        return messages.reverse();
    }

    static async markRoomAsRead(roomId: string, userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const participant = await participantRepo.findOne({
            where: { roomId, userId }
        });

        if (participant) {
            participant.lastReadAt = new Date();
            await participantRepo.save(participant);
        }
    }
}
