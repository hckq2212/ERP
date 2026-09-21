import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import { AppDataSource } from "./data-source";
import { Accounts } from "./modules/account/entities/Account.entity";
import { ChatMessages } from "./modules/chat-room/entities/ChatMessage.entity";
import { ChatParticipants } from "./modules/chat-room/entities/ChatParticipant.entity";

interface AuthenticatedSocket extends Socket {
    user?: {
        accountId: string;
        userId?: string;
        username: string;
    };
}

const onlineUsers = new Map<string, string>();

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

export function initSocket(httpServer: HttpServer) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : [];

    const io = new Server(httpServer, {
        cors: {
            origin: (origin, callback) => {
                if (!origin) return callback(null, true);
                if (
                    allowedOrigins.includes(origin) ||
                    origin.endsWith(".vercel.app") ||
                    origin.endsWith(".onrender.com") ||
                    /^http:\/\/localhost:\d+$/.test(origin)
                ) {
                    callback(null, true);
                } else {
                    callback(new Error("Not allowed by CORS"));
                }
            },
            credentials: true
        }
    });

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
            onlineUsers.set(userId, socket.id);
            io.emit("online_users", Array.from(onlineUsers.keys()));
        }

        console.log(`User connected to Socket.io: ${socket.user?.username} (${socket.id})`);

        socket.on("join_room", (roomId: string) => {
            socket.join(roomId);
        });

        socket.on("leave_room", (roomId: string) => {
            socket.leave(roomId);
        });

        socket.on("typing", (roomId: string) => {
            socket.to(roomId).emit("user_typing", {
                roomId,
                userId: socket.user?.userId,
                username: socket.user?.username
            });
        });

        socket.on("stop_typing", (roomId: string) => {
            socket.to(roomId).emit("user_stop_typing", {
                roomId,
                userId: socket.user?.userId
            });
        });

        socket.on("send_message", async (data: { roomId: string; content: string; attachments?: any[] }) => {
            try {
                const { roomId, content, attachments } = data;
                const senderUserId = socket.user?.userId;
                if (!roomId || !content?.trim() || !senderUserId) return;

                const participantRepo = AppDataSource.getRepository(ChatParticipants);
                const isParticipant = await participantRepo.findOne({
                    where: { roomId, userId: senderUserId }
                });

                if (!isParticipant) {
                    socket.emit("error", { message: "Bạn không thuộc phòng chat này" });
                    return;
                }

                const allParticipants = await participantRepo.find({ where: { roomId } });
                const messageRepo = AppDataSource.getRepository(ChatMessages);
                const newMessage = messageRepo.create({
                    roomId,
                    senderId: senderUserId,
                    content: content.trim(),
                    attachments: attachments || []
                });

                await messageRepo.save(newMessage);

                const populatedMessage = await messageRepo.findOne({
                    where: { id: newMessage.id },
                    relations: ["sender"]
                });

                if (populatedMessage) {
                    allParticipants.forEach((participant) => {
                        const socketId = onlineUsers.get(participant.userId);
                        if (socketId) {
                            io.to(socketId).emit("receive_message", populatedMessage);
                        }
                    });
                }
            } catch (error) {
                console.error("Error in send_message socket event:", error);
                socket.emit("error", { message: "Không thể gửi tin nhắn" });
            }
        });

        socket.on("disconnect", () => {
            if (userId) {
                onlineUsers.delete(userId);
                io.emit("online_users", Array.from(onlineUsers.keys()));
            }
            console.log(`User disconnected from Socket.io: ${socket.user?.username} (${socket.id})`);
        });
    });

    return io;
}
