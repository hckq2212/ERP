import { EventEmitter } from "events";
import { Response } from "express";

/**
 * NotificationEmitter - Singleton EventEmitter for real-time notifications.
 * This bridges the gap between the Service layer (which creates notifications)
 * and the Controller layer (which maintains SSE connections).
 */
class NotificationEmitter extends EventEmitter {}

export const notificationEmitter = new NotificationEmitter();

// Event names as constants to avoid typos
export const NOTIFICATION_EVENTS = {
    NEW_NOTIFICATION: "new_notification",
};

/**
 * NotificationManager - Manages active SSE connections and broadcasts events.
 * This ensures we only have ONE listener on the EventEmitter regardless of connection count.
 */
class NotificationManager {
    private connections = new Map<string, Response[]>();

    constructor() {
        // REGISTER SINGLETON LISTENER
        notificationEmitter.on(NOTIFICATION_EVENTS.NEW_NOTIFICATION, (data: { recipientId: string; notification: any }) => {
            this.broadcast(data.recipientId, data.notification);
        });
    }

    addConnection(userId: string, res: Response) {
        const userConnections = this.connections.get(userId) || [];
        userConnections.push(res);
        this.connections.set(userId, userConnections);
    }

    removeConnection(userId: string, res: Response) {
        let userConnections = this.connections.get(userId) || [];
        userConnections = userConnections.filter(c => c !== res);
        
        if (userConnections.length === 0) {
            this.connections.delete(userId);
        } else {
            this.connections.set(userId, userConnections);
        }
    }

    private broadcast(recipientId: string, notification: any) {
        const userConnections = this.connections.get(recipientId);
        if (userConnections) {
            const data = JSON.stringify(notification);
            userConnections.forEach(res => {
                res.write(`data: ${data}\n\n`);
            });
        }
    }
}

export const notificationManager = new NotificationManager();
