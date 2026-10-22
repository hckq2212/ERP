import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import { AppDataSource } from "./data-source";
import { Accounts } from "./modules/account/entities/Account.entity";
import { ChatParticipants } from "./modules/chat-room/entities/ChatParticipant.entity";
import { ChatRoomService } from "./modules/chat-room/services/ChatRoom.Service";

interface AuthenticatedSocket extends Socket {
    user?: {
        accountId: string;
        userId?: string;
        username: string;
    };
}

const onlineUsers = new Map<string, Set<string>>();

function getOnlineUserIds() {
    return Array.from(onlineUsers.entries())
        .filter(([, socketIds]) => socketIds.size > 0)
        .map(([userId]) => userId);
}

function parseCookie(cookieString: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieString) return cookies;

    cookieString.split(";").forEach((cookie) => {
        const [key, ...valueParts] = cookie.split("=");
        cookies[key.trim()] = valueParts.join("=").trim();
    });

    return cookies;
}

function extractToken(socket: Socket) {
    const cookies = parseCookie(socket.request.headers.cookie || "");
    const authHeader = socket.request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    return socket.handshake.auth?.token
        || socket.handshake.query?.token
        || bearerToken
        || cookies.accessToken;
}

let ioInstance: Server | null = null;

export function getSocketIO() {
    return ioInstance;
}

export async function broadcastToRoom(roomId: string, event: string, payload: any) {
    if (!ioInstance) return;
    try {
        const participantRepo = AppDataSource.getRepository(ChatParticipants);
        const allParticipants = await participantRepo.find({ where: { roomId } });
        const targetSocketIds = new Set<string>();
        allParticipants.forEach((participant) => {
            const socketIds = onlineUsers.get(participant.userId);
            socketIds?.forEach((socketId) => {
                targetSocketIds.add(socketId);
            });
        });
        targetSocketIds.forEach((socketId) => {
            ioInstance?.to(socketId).emit(event, payload);
        });
    } catch (err) {
        console.error("Error broadcasting to room:", err);
    }
}

export function broadcastToUser(userId: string, event: string, payload: any) {
    if (!ioInstance) return;
    try {
        const socketIds = onlineUsers.get(userId);
        socketIds?.forEach((socketId) => {
            ioInstance?.to(socketId).emit(event, payload);
        });
        ioInstance.to(`user:${userId}`).emit(event, payload);
    } catch (err) {
        console.error("Error broadcasting to user:", err);
    }
}

export function initSocket(httpServer: HttpServer) {
    const rawAllowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim().replace(/\/$/, ""))
        : [];

    const io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                console.log(`🌐 [Socket.io CORS Check] Incoming origin: ${origin ? `"${origin}"` : "<no origin / undefined>"}`);
                if (!origin) {
                    console.log(`✅ [Socket.io CORS Allowed] No origin (Mobile native / Server / cURL)`);
                    return callback(null, true);
                }
                const normalized = origin.trim().replace(/\/$/, "");
                if (
                    rawAllowedOrigins.includes(normalized) ||
                    normalized.endsWith(".vercel.app") ||
                    normalized.endsWith(".workers.dev") ||
                    normalized.endsWith(".onrender.com") ||
                    /^http:\/\/localhost:\d+$/.test(normalized) ||
                    /^http:\/\/(192\.168\.\d+\.\d+|10\.0\.2\.2|127\.0\.0\.1)(:\d+)?$/.test(normalized)
                ) {
                    console.log(`✅ [Socket.io CORS Allowed] Origin: "${origin}"`);
                    callback(null, true);
                } else {
                    console.warn(`❌ [Socket.io CORS Blocked] Origin: "${origin}"`);
                    callback(new Error("Not allowed by CORS"));
                }
            },
            credentials: true
        }
    });

    ioInstance = io;

    io.use(async (socket: AuthenticatedSocket, next) => {
        try {
            const token = extractToken(socket);
            if (!token || typeof token !== "string") {
                return next(new Error("Authentication failed. No token provided."));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as any;
            if (!decoded?.id || decoded.type !== "access") {
                return next(new Error("Authentication failed. Invalid token."));
            }

            const account = await AppDataSource.getRepository(Accounts).findOne({
                where: { id: decoded.id },
                relations: ["user"]
            });

            if (!account || !account.isActive) {
                return next(new Error("Authentication failed. Account not found."));
            }

            socket.user = {
                accountId: account.id,
                userId: account.user?.id || account.userId,
                username: account.username
            };

            next();
        } catch (error) {
            console.error("Socket authentication error:", error);
            next(new Error("Authentication failed."));
        }
    });

    io.on("connection", (socket: AuthenticatedSocket) => {
        const userId = socket.user?.userId;
        if (userId) {
            socket.join(`user:${userId}`);
            const socketIds = onlineUsers.get(userId) || new Set<string>();
            socketIds.add(socket.id);
            onlineUsers.set(userId, socketIds);
            io.emit("online_users", getOnlineUserIds());
        }

        console.log(`User connected to Socket.io: ${socket.user?.username} (${socket.id})`);

        socket.on("join_room", (roomId: string) => {
            socket.join(roomId);
        });

        socket.on("leave_room", (roomId: string) => {
            socket.leave(roomId);
        });

        socket.on("typing", (payload: string | { roomId: string }) => {
            const roomId = typeof payload === "string" ? payload : payload?.roomId;
            if (!roomId) return;
            socket.to(roomId).emit("user_typing", {
                roomId,
                userId: socket.user?.userId,
                username: socket.user?.username
            });
        });

        socket.on("stop_typing", (payload: string | { roomId: string }) => {
            const roomId = typeof payload === "string" ? payload : payload?.roomId;
            if (!roomId) return;
            socket.to(roomId).emit("user_stop_typing", {
                roomId,
                userId: socket.user?.userId,
                username: socket.user?.username // bổ sung username để Mobile filter đúng
            });
        });

        socket.on("send_message", async (
            data: { roomId: string; content: string; attachments?: any[]; replyToId?: string },
            ack?: (response: { ok: boolean; message?: any; error?: string }) => void
        ) => {
            try {
                const { roomId, content, attachments, replyToId } = data;
                const senderUserId = socket.user?.userId;
                const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
                if (!roomId || (!content?.trim() && !hasAttachments) || !senderUserId) {
                    ack?.({ ok: false, error: "Tin nhắn không hợp lệ" });
                    return;
                }

                const participantRepo = AppDataSource.getRepository(ChatParticipants);
                const allParticipants = await participantRepo.find({ where: { roomId } });
                const populatedMessage = await ChatRoomService.createMessage(
                    roomId,
                    senderUserId,
                    content || "",
                    attachments || [],
                    replyToId
                );

                if (populatedMessage) {
                    allParticipants.forEach((participant) => {
                        const socketIds = onlineUsers.get(participant.userId);
                        socketIds?.forEach((socketId) => {
                            io.to(socketId).emit("receive_message", populatedMessage);
                        });
                    });
                    ack?.({ ok: true, message: populatedMessage });
                }
            } catch (error: any) {
                console.error("Error in send_message socket event:", error);
                socket.emit("error", { message: "Không thể gửi tin nhắn" });
                ack?.({ ok: false, error: error.message || "Không thể gửi tin nhắn" });
            }
        });

        socket.on("message_reaction", async (
            data: { roomId: string; messageId: string; emoji: string },
            ack?: (response: { ok: boolean; data?: any; error?: string }) => void
        ) => {
            try {
                const { roomId, messageId, emoji } = data;
                const userId = socket.user?.userId;
                if (!roomId || !messageId || !emoji || !userId) {
                    ack?.({ ok: false, error: "Thông tin không hợp lệ" });
                    return;
                }

                const result = await ChatRoomService.reactToMessage(roomId, messageId, userId, emoji);
                await broadcastToRoom(roomId, "message_reaction", result);
                ack?.({ ok: true, data: result });
            } catch (error: any) {
                console.error("Error in message_reaction socket event:", error);
                ack?.({ ok: false, error: error.message || "Lỗi khi thả cảm xúc" });
            }
        });

        socket.on("message_pin", async (
            data: { roomId: string; messageId: string; isPinned?: boolean },
            ack?: (response: { ok: boolean; data?: any; error?: string }) => void
        ) => {
            try {
                const { roomId, messageId, isPinned } = data;
                const userId = socket.user?.userId;
                if (!roomId || !messageId || !userId) {
                    ack?.({ ok: false, error: "Thông tin không hợp lệ" });
                    return;
                }

                const result = await ChatRoomService.pinMessage(roomId, messageId, userId, isPinned !== false);
                await broadcastToRoom(roomId, "message_pinned", result);
                ack?.({ ok: true, data: result });
            } catch (error: any) {
                console.error("Error in message_pin socket event:", error);
                ack?.({ ok: false, error: error.message || "Lỗi khi ghim tin nhắn" });
            }
        });

        socket.on("message_recall", async (
            data: { roomId: string; messageId: string },
            ack?: (response: { ok: boolean; data?: any; error?: string }) => void
        ) => {
            try {
                const { roomId, messageId } = data;
                const userId = socket.user?.userId;
                if (!roomId || !messageId || !userId) {
                    ack?.({ ok: false, error: "Thông tin không hợp lệ" });
                    return;
                }

                const result = await ChatRoomService.recallMessage(roomId, messageId, userId);
                await broadcastToRoom(roomId, "message_recalled", result);
                ack?.({ ok: true, data: result });
            } catch (error: any) {
                console.error("Error in message_recall socket event:", error);
                ack?.({ ok: false, error: error.message || "Lỗi khi thu hồi tin nhắn" });
            }
        });

        socket.on("message_edit", async (
            data: { roomId: string; messageId: string; content: string },
            ack?: (response: { ok: boolean; data?: any; error?: string }) => void
        ) => {
            try {
                const { roomId, messageId, content } = data;
                const userId = socket.user?.userId;
                if (!roomId || !messageId || !userId) {
                    ack?.({ ok: false, error: "Thông tin không hợp lệ" });
                    return;
                }

                const result = await ChatRoomService.editMessage(roomId, messageId, userId, content);
                await broadcastToRoom(roomId, "message_edited", result);
                ack?.({ ok: true, data: result });
            } catch (error: any) {
                console.error("Error in message_edit socket event:", error);
                ack?.({ ok: false, error: error.message || "Lỗi khi sửa tin nhắn" });
            }
        });

        socket.on("disconnect", () => {
            if (userId) {
                const socketIds = onlineUsers.get(userId);
                socketIds?.delete(socket.id);
                if (!socketIds || socketIds.size === 0) {
                    onlineUsers.delete(userId);
                }
                io.emit("online_users", getOnlineUserIds());
            }
            console.log(`User disconnected from Socket.io: ${socket.user?.username} (${socket.id})`);
        });
    });

    return io;
}
