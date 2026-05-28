import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { AppDataSource } from "./data-source";
import { Accounts } from "./entity/Account.entity";
import { ChatMessages } from "./entity/ChatMessage.entity";
import { ChatParticipants } from "./entity/ChatParticipant.entity";

interface AuthenticatedSocket extends Socket {
    user?: {
        accountId: string;
        userId?: string;
        username: string;
    };
}

// Track online users: userId -> socketId
const onlineUsers = new Map<string, string>();

function parseCookie(cookieString: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieString) return cookies;
    cookieString.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        cookies[parts[0].trim()] = (parts[1] || "").trim();
    });
    return cookies;
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

    // Authentication middleware
    io.use(async (socket: AuthenticatedSocket, next) => {
        try {
            const cookies = parseCookie(socket.request.headers.cookie || "");
            const token = 
                socket.handshake.auth?.token || 
                socket.handshake.query?.token || 
                cookies["accessToken"];

            if (!token) {
                return next(new Error("Authentication failed. No token provided."));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as any;
            if (!decoded || !decoded.id) {
                return next(new Error("Authentication failed. Invalid token."));
            }

            const accountRepository = AppDataSource.getRepository(Accounts);
            const account = await accountRepository.findOne({
                where: { id: decoded.id },
                relations: ["user"]
            });

            if (!account) {
                return next(new Error("Authentication failed. Account not found."));
            }

            socket.user = {
                accountId: account.id,
                userId: account.user?.id,
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
            // Broadcast online list to all users
            io.emit("online_users", Array.from(onlineUsers.keys()));
        }

        console.log(`User connected to Socket.io: ${socket.user?.username} (${socket.id})`);

        // Join room room_id
        socket.on("join_room", (roomId: string) => {
            socket.join(roomId);
            console.log(`Socket ${socket.id} joined room: ${roomId}`);
        });

        // Leave room room_id
        socket.on("leave_room", (roomId: string) => {
            socket.leave(roomId);
            console.log(`Socket ${socket.id} left room: ${roomId}`);
        });

        // Typing indicator
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

        // Send message event
        socket.on("send_message", async (data: { roomId: string; content: string; attachments?: any[] }) => {
            try {
                const { roomId, content, attachments } = data;
                if (!roomId || !content) return;

                const senderUserId = socket.user?.userId;
                if (!senderUserId) return;

                // 1. Verify if user is participant of the room
                const participantRepo = AppDataSource.getRepository(ChatParticipants);
                const isParticipant = await participantRepo.findOne({
                    where: { roomId, userId: senderUserId }
                });

                if (!isParticipant) {
                    socket.emit("error", { message: "Bạn không thuộc phòng chat này" });
                    return;
                }

                // 2. Save message to database
                const messageRepo = AppDataSource.getRepository(ChatMessages);
                const newMessage = messageRepo.create({
                    roomId,
                    senderId: senderUserId,
                    content,
                    attachments: attachments || []
                });

                await messageRepo.save(newMessage);

                // 3. Populate sender relations for client display
                const populatedMessage = await messageRepo.findOne({
                    where: { id: newMessage.id },
                    relations: ["sender"]
                });

                if (populatedMessage) {
                    // 4. Broadcast message to room
                    io.to(roomId).emit("receive_message", populatedMessage);
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
