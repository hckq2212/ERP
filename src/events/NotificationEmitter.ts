import { EventEmitter } from "events";
import { Response } from "express";

/**
 * NotificationEmitter - Singleton EventEmitter for real-time notifications.
 * This bridges the gap between the Service layer (which creates notifications)
 * and the Controller layer (which maintains SSE connections).
 */
class NotificationEmitter extends EventEmitter { }

export const notificationEmitter = new NotificationEmitter();

// Event names as constants to avoid typos
export const NOTIFICATION_EVENTS = {
    NEW_NOTIFICATION: "new_notification",
    MODULE_EVENT: "module_event", // New event for transient FE updates
};

/**
 * NotificationManager - Manages active SSE connections and broadcasts events.
 * This ensures we only have ONE listener on the EventEmitter regardless of connection count.
 */
class NotificationManager {
    private connections = new Map<string, Response[]>();

    constructor() {
        // REGISTER SINGLETON LISTENER for Persistent Notifications
        notificationEmitter.on(NOTIFICATION_EVENTS.NEW_NOTIFICATION, (data: { recipientId: string; notification: any }) => {
            // Keep backward compatibility: direct broadcast without wrapping
            this.broadcast(data.recipientId, data.notification);
        });

        // REGISTER SINGLETON LISTENER for Transient Module Events
        notificationEmitter.on(NOTIFICATION_EVENTS.MODULE_EVENT, (data: { recipientId?: string; event: string; payload: any }) => {
            const wrappedPayload = {
                __isModuleEvent: true,
                event: data.event,
                data: data.payload
            };

            if (data.recipientId) {
                console.log(`[SSE] Intentional broadcast to ${data.recipientId} for event ${data.event}`);
                this.broadcast(data.recipientId, wrappedPayload);
            } else {
                const connectionCount = this.connections.size;
                console.log(`[SSE] Global broadcast for event ${data.event} to ${connectionCount} active users`);

                for (const userId of this.connections.keys()) {
                    this.broadcast(userId, wrappedPayload);
                }
            }
        });
    }

    addConnection(userId: string, res: Response) {
        const userConnections = this.connections.get(userId) || [];
        userConnections.push(res);
        this.connections.set(userId, userConnections);
        // console.log(`[SSE] User ${userId} connected. Total active users: ${this.connections.size}`);
    }

    removeConnection(userId: string, res: Response) {
        let userConnections = this.connections.get(userId) || [];
        userConnections = userConnections.filter(c => c !== res);

        if (userConnections.length === 0) {
            this.connections.delete(userId);
            // console.log(`[SSE] User ${userId} disconnected. Total active users: ${this.connections.size}`);
        } else {
            this.connections.set(userId, userConnections);
        }
    }

    private broadcast(recipientId: string, payload: any, sseEvent?: string) {
        const userConnections = this.connections.get(recipientId);
        if (userConnections) {
            const data = JSON.stringify(payload);
            userConnections.forEach(res => {
                if (sseEvent) {
                    res.write(`event: ${sseEvent}\n`);
                }
                res.write(`data: ${data}\n\n`);
            });
        }
    }
}

export const notificationManager = new NotificationManager();
