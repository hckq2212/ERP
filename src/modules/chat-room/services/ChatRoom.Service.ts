import { In, LessThan } from "typeorm";
import { AppDataSource } from "../../../data-source";
import { Accounts } from "../../account/entities/Account.entity";
import { Users } from "../../user/entities/User.entity";
import { ChatMessages } from "../entities/ChatMessage.entity";
import { ChatParticipants } from "../entities/ChatParticipant.entity";
import { ChatRooms } from "../entities/ChatRoom.entity";

export class ChatRoomService {
    private static async resolveUserId(id: string) {
        const userRepo = AppDataSource.getRepository(Users);
        const user = await userRepo.findOne({ where: { id }, select: ["id"] });
        if (user) return user.id;

        const account = await AppDataSource.getRepository(Accounts).findOne({
            where: { id },
            select: ["id", "userId"]
        });

        if (account?.userId) return account.userId;
        throw new Error("Không tìm thấy người dùng để chat");
    }

    private static async resolveUserIds(ids: string[]) {
        const resolved = await Promise.all(ids.map((id) => this.resolveUserId(id)));
        return Array.from(new Set(resolved));
    }

    static async getUserRooms(userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);
        const messageRepo = AppDataSource.getRepository(ChatMessages);

        const userParticipations = await participantRepo.find({
            where: { userId },
            select: ["roomId"]
        });

        if (userParticipations.length === 0) return [];

        const roomIds = userParticipations.map((participant) => participant.roomId);
        const rooms = await roomRepo.find({
            where: { id: In(roomIds) },
            order: { updatedAt: "DESC" }
        });

        const enrichedRooms = await Promise.all(rooms.map(async (room) => {
            const participants = await participantRepo.find({
                where: { roomId: room.id },
                relations: ["user"]
            });

            const latestMessage = await messageRepo.findOne({
                where: { roomId: room.id },
                order: { createdAt: "DESC" },
                relations: ["sender"]
            });

            const myParticipant = participants.find((participant) => participant.userId === userId);
            const lastReadAt = myParticipant?.lastReadAt;
            const unread = latestMessage
                ? latestMessage.senderId !== userId && (!lastReadAt || latestMessage.createdAt > lastReadAt)
                : false;

            return {
                ...room,
                participants,
                latestMessage,
                unread
            };
        }));

        return enrichedRooms.sort((a, b) => {
            const timeA = a.latestMessage?.createdAt || a.updatedAt;
            const timeB = b.latestMessage?.createdAt || b.updatedAt;
            return new Date(timeB).getTime() - new Date(timeA).getTime();
        });
    }

    static async getOrCreateDM(userId1: string, userId2OrAccountId: string) {
        const userId2 = await this.resolveUserId(userId2OrAccountId);
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        const rooms1 = await participantRepo.find({
            where: { userId: userId1 },
            select: ["roomId"]
        });
        const rooms2 = await participantRepo.find({
            where: { userId: userId2 },
            select: ["roomId"]
        });

        const roomIds2 = new Set(rooms2.map((room) => room.roomId));
        const commonRoomIds = rooms1.map((room) => room.roomId).filter((roomId) => roomIds2.has(roomId));

        if (commonRoomIds.length > 0) {
            const existingRoom = await roomRepo.findOne({
                where: {
                    id: In(commonRoomIds),
                    isGroup: false
                }
            });

            if (existingRoom) {
                const participants = await participantRepo.find({
                    where: { roomId: existingRoom.id },
                    relations: ["user"]
                });
                return { ...existingRoom, participants };
            }
        }

        return AppDataSource.transaction(async (transactionalEntityManager) => {
            const newRoom = new ChatRooms();
            newRoom.isGroup = false;
            newRoom.creatorId = userId1;
            await transactionalEntityManager.save(newRoom);

            const participant1 = new ChatParticipants();
            participant1.roomId = newRoom.id;
            participant1.userId = userId1;
            participant1.lastReadAt = new Date();
            await transactionalEntityManager.save(participant1);

            const participant2 = new ChatParticipants();
            participant2.roomId = newRoom.id;
            participant2.userId = userId2;
            participant2.lastReadAt = null;
            await transactionalEntityManager.save(participant2);

            const participants = await participantRepo.find({
                where: { roomId: newRoom.id },
                relations: ["user"]
            });

            return { ...newRoom, participants };
        });
    }

    static async createGroup(creatorId: string, name: string, participantIds: string[]) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const resolvedParticipantIds = await this.resolveUserIds(participantIds);

        return AppDataSource.transaction(async (transactionalEntityManager) => {
            const newRoom = new ChatRooms();
            newRoom.name = name;
            newRoom.isGroup = true;
            newRoom.creatorId = creatorId;
            await transactionalEntityManager.save(newRoom);

            const uniqueParticipantIds = Array.from(new Set([creatorId, ...resolvedParticipantIds]));
            for (const userId of uniqueParticipantIds) {
                const participant = new ChatParticipants();
                participant.roomId = newRoom.id;
                participant.userId = userId;
                participant.lastReadAt = userId === creatorId ? new Date() : null;
                await transactionalEntityManager.save(participant);
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
        const resolvedUserIds = await this.resolveUserIds(userIds);

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            for (const userId of resolvedUserIds) {
                const exists = await participantRepo.findOne({
                    where: { roomId, userId }
                });

                if (!exists) {
                    const participant = new ChatParticipants();
                    participant.roomId = roomId;
                    participant.userId = userId;
                    participant.lastReadAt = null;
                    await transactionalEntityManager.save(participant);
                }
            }
        });

        return participantRepo.find({
            where: { roomId },
            relations: ["user"]
        });
    }

    static async getRoomMessages(roomId: string, limit = 50, cursor?: string) {
        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const where: { roomId: string; id?: any } = { roomId };
        if (cursor) {
            where.id = LessThan(cursor);
        }

        const messages = await messageRepo.find({
            where,
            relations: ["sender"],
            order: { id: "DESC" },
            take: limit
        });

        return messages.reverse();
    }

    static async isParticipant(roomId: string, userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        return Boolean(await participantRepo.findOne({ where: { roomId, userId } }));
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
