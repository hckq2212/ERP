import { In, LessThan, MoreThan, Not } from "typeorm";
import { AppDataSource } from "../../../data-source";
import { Accounts } from "../../account/entities/Account.entity";
import { Users } from "../../user/entities/User.entity";
import { ChatMessages } from "../entities/ChatMessage.entity";
import { ChatParticipants } from "../entities/ChatParticipant.entity";
import { ChatRooms } from "../entities/ChatRoom.entity";
import { broadcastToRoom, broadcastToUser } from "../../../socket";
import { PushNotificationService } from "../../notification/services/PushNotification.Service";
import { formatChatPushContent } from "../helpers/ChatPushContent.helper";

export class ChatRoomService {
    private static pushNotificationService = new PushNotificationService();
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

    static async createSystemMessage(
        roomId: string,
        actorId: string,
        content: string,
        systemMetadata: NonNullable<ChatMessages["systemMetadata"]>
    ) {
        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const newMessage = messageRepo.create({
            roomId,
            senderId: actorId,
            content,
            isSystem: true,
            systemMetadata,
            attachments: null,
            replyToId: null
        });

        await messageRepo.save(newMessage);

        const savedMessage = await messageRepo.findOne({
            where: { id: newMessage.id },
            relations: ["sender", "replyTo", "replyTo.sender"]
        });

        if (savedMessage) {
            await broadcastToRoom(roomId, "receive_message", savedMessage);
        }

        return savedMessage;
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
            const isPinned = Boolean(myParticipant?.isPinned);
            const isMuted = Boolean(myParticipant?.isMuted);
            const unreadCount = await messageRepo.count({
                where: {
                    roomId: room.id,
                    senderId: Not(userId),
                    ...(lastReadAt ? { createdAt: MoreThan(lastReadAt) } : {})
                }
            });

            if (room.isGroup) {
                const hasAdmin = participants.some((p) => p.role === "ADMIN");
                if (!hasAdmin && participants.length > 0) {
                    let adminParticipant = room.creatorId
                        ? participants.find((p) => p.userId === room.creatorId)
                        : null;
                    if (!adminParticipant) {
                        adminParticipant = participants[0];
                    }
                    adminParticipant.role = "ADMIN";
                    // Asynchronously persist to DB so legacy rooms become permanent
                    participantRepo.update({ id: adminParticipant.id }, { role: "ADMIN" }).catch(() => {});
                    if (!room.creatorId) {
                        roomRepo.update({ id: room.id }, { creatorId: adminParticipant.userId }).catch(() => {});
                    }
                }
            }

            const enrichedParticipants = participants.map((p) => ({
                ...p,
                role: p.role || (room.creatorId && p.userId === room.creatorId ? "ADMIN" : "MEMBER")
            }));

            return {
                ...room,
                participants: enrichedParticipants,
                latestMessage,
                unread: unreadCount > 0,
                unreadCount,
                isPinned,
                isMuted
            };
        }));

        return enrichedRooms.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
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

        const createdRoom = await AppDataSource.transaction(async (transactionalEntityManager) => {
            const newRoom = new ChatRooms();
            newRoom.isGroup = false;
            newRoom.creatorId = userId1;
            await transactionalEntityManager.save(newRoom);

            const participant1 = new ChatParticipants();
            participant1.roomId = newRoom.id;
            participant1.userId = userId1;
            participant1.lastReadAt = null;
            await transactionalEntityManager.save(participant1);

            const participant2 = new ChatParticipants();
            participant2.roomId = newRoom.id;
            participant2.userId = userId2;
            participant2.lastReadAt = null;
            await transactionalEntityManager.save(participant2);

            return newRoom;
        });

        const participants = await participantRepo.find({
            where: { roomId: createdRoom.id },
            relations: ["user"]
        });

        return { ...createdRoom, participants };
    }

    static async createGroup(creatorId: string, name: string, participantIds: string[], avatarUrl?: string | null) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const userRepo = AppDataSource.getRepository(Users);
        const resolvedParticipantIds = await this.resolveUserIds(participantIds);
        const uniqueParticipantIds = Array.from(new Set([creatorId, ...resolvedParticipantIds]));

        const createdRoom = await AppDataSource.transaction(async (transactionalEntityManager) => {
            const newRoom = new ChatRooms();
            newRoom.name = name;
            newRoom.isGroup = true;
            newRoom.creatorId = creatorId;
            if (avatarUrl) {
                newRoom.avatarUrl = avatarUrl;
            }
            await transactionalEntityManager.save(newRoom);

            for (const userId of uniqueParticipantIds) {
                const participant = new ChatParticipants();
                participant.roomId = newRoom.id;
                participant.userId = userId;
                participant.role = userId === creatorId ? "ADMIN" : "MEMBER";
                participant.lastReadAt = null;
                await transactionalEntityManager.save(participant);
            }

            return newRoom;
        });

        const creator = await userRepo.findOne({ where: { id: creatorId }, select: ["id", "fullName"] });
        const creatorName = creator?.fullName || "Người tạo";

        await this.createSystemMessage(
            createdRoom.id,
            creatorId,
            `${creatorName} đã tạo nhóm chat.`,
            {
                action: "CREATE_GROUP",
                actorId: creatorId,
                actorName: creatorName
            }
        );

        for (const uid of uniqueParticipantIds) {
            broadcastToUser(uid, "room_added", { roomId: createdRoom.id });
        }

        const participants = await participantRepo.find({
            where: { roomId: createdRoom.id },
            relations: ["user"]
        });

        return { ...createdRoom, participants };
    }

    static async addParticipants(roomId: string, userIds: string[], actorId?: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const userRepo = AppDataSource.getRepository(Users);
        const resolvedUserIds = await this.resolveUserIds(userIds);
        const newlyAddedIds: string[] = [];

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            for (const userId of resolvedUserIds) {
                const exists = await participantRepo.findOne({
                    where: { roomId, userId }
                });

                if (!exists) {
                    const participant = new ChatParticipants();
                    participant.roomId = roomId;
                    participant.userId = userId;
                    participant.role = "MEMBER";
                    participant.lastReadAt = null;
                    await transactionalEntityManager.save(participant);
                    newlyAddedIds.push(userId);
                }
            }
        });

        if (newlyAddedIds.length > 0) {
            const actor = actorId
                ? await userRepo.findOne({ where: { id: actorId }, select: ["id", "fullName"] })
                : null;
            const actorName = actor?.fullName || "Quản trị viên";
            const addedUsers = await userRepo.find({
                where: { id: In(newlyAddedIds) },
                select: ["id", "fullName"]
            });
            const targetNames = addedUsers.map((u) => u.fullName || "Thành viên");

            await this.createSystemMessage(
                roomId,
                actorId || newlyAddedIds[0],
                `${actorName} đã thêm ${targetNames.join(", ")} vào nhóm.`,
                {
                    action: "ADD_MEMBER",
                    actorId: actorId || newlyAddedIds[0],
                    actorName,
                    targetIds: newlyAddedIds,
                    targetNames
                }
            );

            for (const uid of newlyAddedIds) {
                broadcastToUser(uid, "room_added", { roomId });
            }
        }

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
            relations: ["sender", "replyTo", "replyTo.sender"],
            order: { id: "DESC" },
            take: limit
        });

        return messages.reverse();
    }

    static async createMessage(
        roomId: string,
        senderUserId: string,
        content: string,
        attachments: any[] = [],
        replyToId?: string | null,
        isForwarded: boolean = false,
        forwardedFromUserId?: string | null
    ) {
        const isParticipant = await this.isParticipant(roomId, senderUserId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const newMessage = messageRepo.create({
            roomId,
            senderId: senderUserId,
            content: content.trim(),
            attachments,
            replyToId: replyToId || null,
            isForwarded: Boolean(isForwarded),
            forwardedFromUserId: forwardedFromUserId || null
        });

        await messageRepo.save(newMessage);

        const populated = await messageRepo.findOne({
            where: { id: newMessage.id },
            relations: ["sender", "replyTo", "replyTo.sender"]
        });

        // Tự động đẩy Push Notification tới các thành viên khác trong phòng chat (chạy nền, không block)
        if (populated) {
            this.sendPushNotificationForMessage(populated, roomId, senderUserId).catch((err) => {
                console.error("[ChatPushNotification] Lỗi gửi push chat:", err);
            });
        }

        return populated;
    }

    /**
     * Gửi Push Notification thông báo tin nhắn mới tới các thành viên trong phòng chat
     */
    private static async sendPushNotificationForMessage(
        populatedMessage: ChatMessages,
        roomId: string,
        senderUserId: string
    ) {
        try {
            const roomRepo = AppDataSource.getRepository(ChatRooms);
            const participantRepo = AppDataSource.getRepository(ChatParticipants);

            const [room, participants] = await Promise.all([
                roomRepo.findOne({ where: { id: roomId } }),
                participantRepo.find({ where: { roomId } })
            ]);

            const senderName = populatedMessage.sender?.fullName || "Người dùng";
            let title = senderName;
            let body = "";

            if (populatedMessage.content?.trim()) {
                body = formatChatPushContent(populatedMessage.content, 120);
            } else if (populatedMessage.attachments?.length) {
                body = `[Đã gửi ${populatedMessage.attachments.length} tệp đính kèm]`;
            } else {
                body = "Đã gửi tin nhắn cho bạn";
            }

            if (room?.isGroup) {
                title = room.name || "Nhóm trò chuyện";
                body = `${senderName}: ${body}`;
            }

            // Gửi tới tất cả thành viên khác trong phòng chưa tắt thông báo (isMuted)
            const recipientIds = participants
                .filter(p => p.userId !== senderUserId && !p.isMuted)
                .map(p => p.userId);

            if (recipientIds.length === 0) return;

            await Promise.allSettled(
                recipientIds.map(recipientId =>
                    this.pushNotificationService.sendPushNotification(recipientId, {
                        id: populatedMessage.id,
                        title,
                        content: body,
                        link: `/chat/${roomId}`,
                        relatedEntityId: roomId,
                        relatedEntityType: "CHAT_ROOM",
                        type: "CHAT_MESSAGE"
                    })
                )
            );
        } catch (error) {
            console.error("[ChatPushNotification] Lỗi trong quá trình gửi push chat:", error);
        }
    }

    static async isParticipant(roomId: string, userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        return Boolean(await participantRepo.findOne({ where: { roomId, userId } }));
    }

    static async markRoomAsRead(roomId: string, userId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        await participantRepo.createQueryBuilder()
            .update(ChatParticipants)
            .set({ lastReadAt: () => "CURRENT_TIMESTAMP(6)" })
            .where('"roomId" = :roomId AND "userId" = :userId', { roomId, userId })
            .execute();
    }

    static async updateParticipantRole(
        roomId: string,
        targetUserId: string,
        newRole: "ADMIN" | "DEPUTY" | "MEMBER",
        requesterId: string
    ) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        const room = await roomRepo.findOne({ where: { id: roomId } });
        if (!room || !room.isGroup) {
            const error: any = new Error("Phòng chat không hợp lệ hoặc không phải nhóm");
            error.statusCode = 400;
            throw error;
        }

        const requester = await participantRepo.findOne({ where: { roomId, userId: requesterId } });
        const target = await participantRepo.findOne({ where: { roomId, userId: targetUserId } });

        if (!requester || !target) {
            const error: any = new Error("Thành viên không thuộc nhóm này");
            error.statusCode = 404;
            throw error;
        }

        const requesterRole = requester.role || (requester.userId === room.creatorId ? "ADMIN" : "MEMBER");
        if (requesterRole !== "ADMIN") {
            const error: any = new Error("Chỉ trưởng nhóm mới có quyền thay đổi vai trò thành viên");
            error.statusCode = 403;
            throw error;
        }

        await AppDataSource.transaction(async (manager) => {
            if (newRole === "ADMIN") {
                // Chuyển quyền trưởng nhóm: requester trở thành DEPUTY, target trở thành ADMIN
                requester.role = "DEPUTY";
                await manager.save(requester);

                target.role = "ADMIN";
                await manager.save(target);

                room.creatorId = targetUserId;
                await manager.save(room);
            } else {
                target.role = newRole;
                await manager.save(target);
            }
        });

        const userRepo = AppDataSource.getRepository(Users);
        const [requesterUser, targetUser] = await Promise.all([
            userRepo.findOne({ where: { id: requesterId }, select: ["id", "fullName"] }),
            userRepo.findOne({ where: { id: targetUserId }, select: ["id", "fullName"] })
        ]);
        const requesterName = requesterUser?.fullName || "Quản trị viên";
        const targetName = targetUser?.fullName || "Thành viên";

        if (newRole === "ADMIN" || newRole === "DEPUTY") {
            await this.createSystemMessage(
                roomId,
                requesterId,
                `${requesterName} đã thêm ${targetName} làm quản trị viên nhóm.`,
                {
                    action: "SET_ADMIN",
                    actorId: requesterId,
                    actorName: requesterName,
                    targetId: targetUserId,
                    targetName
                }
            );
        } else {
            await this.createSystemMessage(
                roomId,
                requesterId,
                `${requesterName} đã gỡ quyền quản trị viên của ${targetName}.`,
                {
                    action: "REMOVE_ADMIN",
                    actorId: requesterId,
                    actorName: requesterName,
                    targetId: targetUserId,
                    targetName
                }
            );
        }

        const updatedParticipants = await participantRepo.find({
            where: { roomId },
            relations: ["user"]
        });

        return updatedParticipants.map(p => ({
            ...p,
            role: p.role || (p.userId === room.creatorId ? "ADMIN" : "MEMBER")
        }));
    }

    static async removeParticipant(roomId: string, targetUserId: string, requesterId: string) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        const room = await roomRepo.findOne({ where: { id: roomId } });
        if (!room || !room.isGroup) {
            const error: any = new Error("Phòng chat không hợp lệ hoặc không phải nhóm");
            error.statusCode = 400;
            throw error;
        }

        const requester = await participantRepo.findOne({ where: { roomId, userId: requesterId } });
        const target = await participantRepo.findOne({ where: { roomId, userId: targetUserId } });

        if (!requester || !target) {
            const error: any = new Error("Thành viên không tồn tại trong nhóm");
            error.statusCode = 404;
            throw error;
        }

        const requesterRole = requester.role || (requester.userId === room.creatorId ? "ADMIN" : "MEMBER");
        const targetRole = target.role || (target.userId === room.creatorId ? "ADMIN" : "MEMBER");

        const isSelfLeaving = requesterId === targetUserId;

        if (!isSelfLeaving) {
            if (requesterRole === "MEMBER") {
                const error: any = new Error("Bạn không có quyền xóa thành viên");
                error.statusCode = 403;
                throw error;
            }
            if (requesterRole === "DEPUTY" && (targetRole === "ADMIN" || targetRole === "DEPUTY")) {
                const error: any = new Error("Phó nhóm không thể xóa Trưởng nhóm hoặc Phó nhóm khác");
                error.statusCode = 403;
                throw error;
            }
        } else {
            const totalMembers = await participantRepo.count({ where: { roomId } });
            if (requesterRole === "ADMIN" && totalMembers > 1) {
                const error: any = new Error("Trưởng nhóm vui lòng chuyển quyền trước khi rời nhóm");
                error.statusCode = 400;
                throw error;
            }
        }

        const userRepo = AppDataSource.getRepository(Users);
        const [requesterUser, targetUser] = await Promise.all([
            userRepo.findOne({ where: { id: requesterId }, select: ["id", "fullName"] }),
            userRepo.findOne({ where: { id: targetUserId }, select: ["id", "fullName"] })
        ]);
        const requesterName = requesterUser?.fullName || "Quản trị viên";
        const targetName = targetUser?.fullName || "Thành viên";

        await participantRepo.remove(target);

        if (isSelfLeaving) {
            await this.createSystemMessage(
                roomId,
                requesterId,
                `${targetName} đã rời khỏi nhóm.`,
                {
                    action: "LEAVE_GROUP",
                    actorId: requesterId,
                    actorName: targetName
                }
            );
        } else {
            await this.createSystemMessage(
                roomId,
                requesterId,
                `${requesterName} đã xóa ${targetName} khỏi nhóm.`,
                {
                    action: "REMOVE_MEMBER",
                    actorId: requesterId,
                    actorName: requesterName,
                    targetId: targetUserId,
                    targetName
                }
            );
            broadcastToUser(targetUserId, "room_removed", { roomId });
        }

        const remainingParticipants = await participantRepo.find({
            where: { roomId },
            relations: ["user"]
        });

        return remainingParticipants.map(p => ({
            ...p,
            role: p.role || (p.userId === room.creatorId ? "ADMIN" : "MEMBER")
        }));
    }

    static async updateRoom(roomId: string, userId: string, updateData: { name?: string; avatarUrl?: string | null }) {
        const roomRepo = AppDataSource.getRepository(ChatRooms);
        const participantRepo = AppDataSource.getRepository(ChatParticipants);

        const room = await roomRepo.findOne({ where: { id: roomId } });
        if (!room) {
            const error: any = new Error("Phòng chat không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        const resolvedUserId = await this.resolveUserId(userId).catch(() => userId);
        const participant = await participantRepo.findOne({
            where: [
                { roomId, userId: resolvedUserId },
                { roomId, userId }
            ]
        });
        if (!participant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const oldName = room.name;
        const oldAvatar = room.avatarUrl;

        if (updateData.name !== undefined) {
            const trimmedName = updateData.name.trim();
            if (!trimmedName) {
                const error: any = new Error("Tên nhóm không được để trống");
                error.statusCode = 400;
                throw error;
            }
            room.name = trimmedName;
        }

        if (updateData.avatarUrl !== undefined) {
            room.avatarUrl = updateData.avatarUrl;
        }

        await roomRepo.save(room);

        if (room.isGroup) {
            const userRepo = AppDataSource.getRepository(Users);
            const actor = await userRepo.findOne({ where: { id: userId }, select: ["id", "fullName"] });
            const actorName = actor?.fullName || "Thành viên";

            if (updateData.name !== undefined && room.name !== oldName) {
                await this.createSystemMessage(
                    roomId,
                    userId,
                    `${actorName} đã đổi tên nhóm thành "${room.name}".`,
                    {
                        action: "RENAME_GROUP",
                        actorId: userId,
                        actorName,
                        oldName,
                        newName: room.name
                    }
                );
            }

            if (updateData.avatarUrl !== undefined && room.avatarUrl !== oldAvatar) {
                await this.createSystemMessage(
                    roomId,
                    userId,
                    `${actorName} đã đổi ảnh đại diện nhóm.`,
                    {
                        action: "CHANGE_AVATAR",
                        actorId: userId,
                        actorName
                    }
                );
            }
        }

        const participants = await participantRepo.find({
            where: { roomId },
            relations: ["user"]
        });

        return { ...room, participants };
    }

    static async updateParticipantPreferences(
        roomId: string,
        userId: string,
        preferences: { isPinned?: boolean; isMuted?: boolean }
    ) {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const resolvedUserId = await this.resolveUserId(userId).catch(() => userId);
        const participant = await participantRepo.findOne({
            where: [
                { roomId, userId: resolvedUserId },
                { roomId, userId }
            ]
        });

        if (!participant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        if (typeof preferences.isPinned === "boolean") {
            participant.isPinned = preferences.isPinned;
        }
        if (typeof preferences.isMuted === "boolean") {
            participant.isMuted = preferences.isMuted;
        }

        await participantRepo.save(participant);

        return {
            roomId,
            userId,
            isPinned: participant.isPinned,
            isMuted: participant.isMuted
        };
    }

    static async reactToMessage(
        roomId: string,
        messageId: string,
        userId: string,
        emoji: string
    ) {
        const isParticipant = await this.isParticipant(roomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const userRepo = AppDataSource.getRepository(Users);

        const message = await messageRepo.findOne({
            where: { id: messageId, roomId }
        });

        if (!message) {
            const error: any = new Error("Tin nhắn không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        const user = await userRepo.findOne({
            where: { id: userId },
            select: ["id", "fullName", "avatarUrl"]
        });

        const currentReactions = Array.isArray(message.reactions) ? [...message.reactions] : [];
        const existingIndex = currentReactions.findIndex((r) => String(r.userId) === String(userId));

        if (existingIndex !== -1) {
            const existingReaction = currentReactions[existingIndex];
            if (existingReaction.emoji === emoji) {
                // Same emoji -> Toggle off (remove reaction)
                currentReactions.splice(existingIndex, 1);
            } else {
                // Different emoji -> Update reaction
                currentReactions[existingIndex] = {
                    ...existingReaction,
                    emoji,
                    createdAt: new Date().toISOString()
                };
            }
        } else {
            // New reaction
            currentReactions.push({
                userId,
                emoji,
                user: {
                    id: user?.id || userId,
                    fullName: user?.fullName || "Thành viên",
                    avatarUrl: user?.avatarUrl || null
                },
                createdAt: new Date().toISOString()
            });
        }

        message.reactions = currentReactions;
        await messageRepo.save(message);

        return {
            messageId,
            roomId,
            reactions: message.reactions
        };
    }

    static async pinMessage(roomId: string, messageId: string, userId: string, isPinned: boolean) {
        const isParticipant = await this.isParticipant(roomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const message = await messageRepo.findOne({
            where: { id: messageId, roomId },
            relations: ["sender"]
        });

        if (!message) {
            const error: any = new Error("Tin nhắn không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        if (message.isRecalled) {
            const error: any = new Error("Không thể ghim tin nhắn đã bị thu hồi");
            error.statusCode = 400;
            throw error;
        }

        message.isPinned = Boolean(isPinned);
        message.pinnedAt = isPinned ? new Date() : null;
        message.pinnedById = isPinned ? userId : null;
        await messageRepo.save(message);

        const userRepo = AppDataSource.getRepository(Users);
        const actor = await userRepo.findOne({ where: { id: userId }, select: ["id", "fullName"] });
        const actorName = actor?.fullName || "Thành viên";

        if (isPinned) {
            const preview = message.content
                ? (message.content.length > 50 ? message.content.slice(0, 50) + "..." : message.content)
                : "[Tệp đính kèm]";
            await this.createSystemMessage(
                roomId,
                userId,
                `${actorName} đã ghim một tin nhắn.`,
                {
                    action: "PIN_MESSAGE",
                    actorId: userId,
                    actorName,
                    pinnedMessageId: messageId,
                    pinnedMessagePreview: preview
                }
            );
        } else {
            await this.createSystemMessage(
                roomId,
                userId,
                `${actorName} đã bỏ ghim một tin nhắn.`,
                {
                    action: "UNPIN_MESSAGE",
                    actorId: userId,
                    actorName,
                    pinnedMessageId: messageId
                }
            );
        }

        return {
            messageId,
            roomId,
            isPinned: message.isPinned,
            pinnedAt: message.pinnedAt,
            pinnedById: message.pinnedById,
            message
        };
    }

    static async getPinnedMessages(roomId: string, userId: string) {
        const isParticipant = await this.isParticipant(roomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        return messageRepo.find({
            where: { roomId, isPinned: true },
            relations: ["sender"],
            order: { pinnedAt: "DESC" }
        });
    }

    static async recallMessage(roomId: string, messageId: string, userId: string) {
        const isParticipant = await this.isParticipant(roomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const roomRepo = AppDataSource.getRepository(ChatRooms);

        const message = await messageRepo.findOne({
            where: { id: messageId, roomId },
            relations: ["sender"]
        });

        if (!message) {
            const error: any = new Error("Tin nhắn không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        if (message.isRecalled) {
            return { messageId, roomId, message };
        }

        // Quyền thu hồi: Chỉ chính người gửi mới có quyền thu hồi tin nhắn của mình
        const isSender = String(message.senderId) === String(userId);
        if (!isSender) {
            const error: any = new Error("Bạn chỉ có thể thu hồi tin nhắn do chính mình gửi");
            error.statusCode = 403;
            throw error;
        }

        message.isRecalled = true;
        message.recalledAt = new Date();
        message.content = "[Tin nhắn đã được thu hồi]";
        message.attachments = null;
        message.reactions = null;
        message.isPinned = false;
        message.pinnedAt = null;
        message.pinnedById = null;
        await messageRepo.save(message);

        return {
            messageId,
            roomId,
            message
        };
    }

    static async editMessage(roomId: string, messageId: string, userId: string, newContent: string) {
        const isParticipant = await this.isParticipant(roomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat này");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const message = await messageRepo.findOne({
            where: { id: messageId, roomId },
            relations: ["sender"]
        });

        if (!message) {
            const error: any = new Error("Tin nhắn không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        if (message.isRecalled) {
            const error: any = new Error("Không thể chỉnh sửa tin nhắn đã bị thu hồi");
            error.statusCode = 400;
            throw error;
        }

        // Chỉ người gửi mới được sửa tin nhắn
        if (String(message.senderId) !== String(userId)) {
            const error: any = new Error("Bạn chỉ có thể chỉnh sửa tin nhắn do chính mình gửi");
            error.statusCode = 403;
            throw error;
        }

        // Kiểm tra thời hạn 15 phút
        const messageCreatedAt = new Date(message.createdAt).getTime();
        const diffMinutes = (Date.now() - messageCreatedAt) / (1000 * 60);
        if (diffMinutes > 15) {
            const error: any = new Error("Bạn chỉ có tối đa 15 phút kể từ khi gửi để chỉnh sửa tin nhắn");
            error.statusCode = 400;
            throw error;
        }

        if (!newContent || !newContent.trim()) {
            const error: any = new Error("Nội dung tin nhắn không được để trống");
            error.statusCode = 400;
            throw error;
        }

        message.content = newContent.trim();
        message.isEdited = true;
        message.editedAt = new Date();
        await messageRepo.save(message);

        return {
            messageId,
            roomId,
            message
        };
    }

    static async forwardMessage(sourceRoomId: string, messageId: string, targetRoomIds: string[], userId: string) {
        const isParticipant = await this.isParticipant(sourceRoomId, userId);
        if (!isParticipant) {
            const error: any = new Error("Bạn không thuộc phòng chat nguồn");
            error.statusCode = 403;
            throw error;
        }

        const messageRepo = AppDataSource.getRepository(ChatMessages);
        const sourceMessage = await messageRepo.findOne({
            where: { id: messageId, roomId: sourceRoomId }
        });

        if (!sourceMessage) {
            const error: any = new Error("Tin nhắn nguồn không tồn tại");
            error.statusCode = 404;
            throw error;
        }

        if (sourceMessage.isRecalled) {
            const error: any = new Error("Không thể chuyển tiếp tin nhắn đã bị thu hồi");
            error.statusCode = 400;
            throw error;
        }

        // Quy tắc: Nếu tin nhắn do người khác tạo -> Đánh dấu chuyển tiếp (isForwarded = true)
        // Nếu tin nhắn do chính bản thân tạo -> KHÔNG cần đánh dấu chuyển tiếp (isForwarded = false)
        const isSelfCreated = String(sourceMessage.senderId) === String(userId) && !sourceMessage.isForwarded;
        const willMarkForwarded = !isSelfCreated;
        const originalSenderId = willMarkForwarded
            ? (sourceMessage.forwardedFromUserId || sourceMessage.senderId)
            : null;

        const createdMessages = [];
        for (const targetRoomId of targetRoomIds) {
            const canSend = await this.isParticipant(targetRoomId, userId);
            if (!canSend) continue;

            const newMsg = await this.createMessage(
                targetRoomId,
                userId,
                sourceMessage.content,
                sourceMessage.attachments || [],
                null,
                willMarkForwarded,
                originalSenderId
            );
            if (newMsg) createdMessages.push(newMsg);
        }

        return createdMessages;
    }
}
