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

export function broadcastToRoom(roomId: string, event: string, payload: unknown): void {
    if (!ioInstance) return;
    try {
        ioInstance.to(roomId).emit(event, payload);
    } catch (err) {
        console.error("Error broadcasting to room:", err);
    }
}

export function userJoinRoom(userId: string, roomId: string): void {
    if (!ioInstance) return;
    ioInstance.in(`user:${userId}`).socketsJoin(roomId);
}

export function userLeaveRoom(userId: string, roomId: string): void {
    if (!ioInstance) return;
    ioInstance.in(`user:${userId}`).socketsLeave(roomId);
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

            // Pre-join socket vào các phòng chat của user NGAY TRONG handshake
            // Đảm bảo khi handshake hoàn tất và event 'connection' kích hoạt, socket ĐÃ nằm trong toàn bộ rooms!
            const userId = socket.user.userId;
            if (userId) {
                try {
                    const participations = await AppDataSource.getRepository(ChatParticipants).find({
                        where: { userId },
                        select: ["roomId"]
                    });
                    socket.join(`user:${userId}`);
                    participations.forEach((p) => socket.join(p.roomId));
                } catch (roomErr) {
                    console.error("Error pre-joining chat rooms in socket handshake:", roomErr);
                }
            }

            next();
        } catch (error) {
            console.error("Socket authentication error:", error);
            next(new Error("Authentication failed."));
        }
    });

    io.on("connection", (socket: AuthenticatedSocket) => {
        const userId = socket.user?.userId;
        if (userId) {
            const socketIds = onlineUsers.get(userId) || new Set<string>();
            socketIds.add(socket.id);
            onlineUsers.set(userId, socketIds);
            io.emit("online_users", getOnlineUserIds());
        }

        console.log(`User connected to Socket.io: ${socket.user?.username} (${socket.id})`);

        socket.on("join_room", async (roomId: string) => {
            const userId = socket.user?.userId;
            if (!userId || !roomId) return;
            try {
                const isMember = await AppDataSource.getRepository(ChatParticipants).count({
                    where: { roomId, userId }
                });
                if (isMember > 0) {
                    socket.join(roomId);
                } else {
                    console.warn(`[Socket] User ${userId} không có quyền join phòng chat ${roomId}`);
                }
            } catch (err) {
                console.error("Lỗi xác thực tham gia phòng trên socket join_room:", err);
            }
        });

        socket.on("leave_room", async (roomId: string) => {
            const userId = socket.user?.userId;
            if (!userId || !roomId) return;
            try {
                const isMember = await AppDataSource.getRepository(ChatParticipants).count({
                    where: { roomId, userId }
                });
                // Nếu user vẫn là thành viên trong phòng (chỉ là chuyển màn hình/active room trên UI),
                // giữ nguyên socket trong room để tiếp tục nhận tin nhắn thời gian thực.
                // Chỉ ngắt socket khỏi room khi user thực sự không còn là thành viên trong DB.
                if (isMember === 0) {
                    socket.leave(roomId);
                }
            } catch (err) {
                console.error("Lỗi kiểm tra tham gia phòng trên socket leave_room:", err);
            }
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

                const populatedMessage = await ChatRoomService.createMessage(
                    roomId,
                    senderUserId,
                    content || "",
                    attachments || [],
                    replyToId
                );

                if (populatedMessage) {
                    io.to(roomId).emit("receive_message", populatedMessage);
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
