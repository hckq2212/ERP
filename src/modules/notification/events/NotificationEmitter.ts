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

export const GLOBAL_NOTIFICATION_CHANNEL = "global";

/**
 * NotificationManager - Manages active SSE connections and broadcasts events.
 * This ensures we only have ONE listener on the EventEmitter regardless of connection count.
 */
type NewNotificationEvent = {
    channelId?: string;
    recipientId: string;
    notification: any;
};

type ModuleEvent = {
    channelId?: string;
    recipientId?: string;
    event: string;
    payload: any;
};

class NotificationManager {
    private connections = new Map<string, Map<string, Response[]>>();

    constructor() {
        // REGISTER SINGLETON LISTENER for Persistent Notifications
        notificationEmitter.on(NOTIFICATION_EVENTS.NEW_NOTIFICATION, (data: NewNotificationEvent) => {
            this.broadcastToUser(data.channelId || GLOBAL_NOTIFICATION_CHANNEL, data.recipientId, data.notification);
        });

        // REGISTER SINGLETON LISTENER for Transient Module Events
        notificationEmitter.on(NOTIFICATION_EVENTS.MODULE_EVENT, (data: ModuleEvent) => {
            const channel = data.channelId || GLOBAL_NOTIFICATION_CHANNEL;

            const wrappedPayload = {
                __isModuleEvent: true,
                event: data.event,
                data: data.payload
            };

            if (data.recipientId) {
                console.log(`[SSE] User broadcast to ${channel}:${data.recipientId} for event ${data.event}`);
                this.broadcastToUser(channel, data.recipientId, wrappedPayload);
            } else {
                const connectionCount = this.getChannelConnectionCount(channel);
                console.log(`[SSE] Broadcast for event ${data.event} to ${connectionCount} active connections`);
                this.broadcastToChannel(channel, wrappedPayload);
            }
        });
    }

    addConnection(channelId: string, userId: string, res: Response) {
        const channelConnections = this.connections.get(channelId) || new Map<string, Response[]>();
        const userConnections = channelConnections.get(userId) || [];
        userConnections.push(res);
        channelConnections.set(userId, userConnections);
        this.connections.set(channelId, channelConnections);
    }

    removeConnection(channelId: string, userId: string, res: Response) {
        const channelConnections = this.connections.get(channelId);
        if (!channelConnections) return;

        let userConnections = channelConnections.get(userId) || [];
        userConnections = userConnections.filter(c => c !== res);

        if (userConnections.length === 0) {
            channelConnections.delete(userId);
        } else {
            channelConnections.set(userId, userConnections);
        }

        if (channelConnections.size === 0) {
            this.connections.delete(channelId);
        }
    }

    broadcastToUser(channelId: string, recipientId: string, payload: any, sseEvent?: string) {
        const userConnections = this.connections.get(channelId)?.get(recipientId);
        if (userConnections) {
            this.writeToConnections(userConnections, payload, sseEvent);
        }
    }

    broadcastToChannel(channelId: string, payload: any, sseEvent?: string) {
        const channelConnections = this.connections.get(channelId);
        if (!channelConnections) return;

        for (const userConnections of channelConnections.values()) {
            this.writeToConnections(userConnections, payload, sseEvent);
        }
    }

    private getChannelConnectionCount(channelId: string) {
        const channelConnections = this.connections.get(channelId);
        if (!channelConnections) return 0;
        let total = 0;
        for (const userConnections of channelConnections.values()) {
            total += userConnections.length;
        }
        return total;
    }

    private writeToConnections(userConnections: Response[], payload: any, sseEvent?: string) {
        const data = JSON.stringify(payload);
        userConnections.forEach(res => {
            if (sseEvent) {
                res.write(`event: ${sseEvent}\n`);
            }
            res.write(`data: ${data}\n\n`);
        });
    }
}

export const notificationManager = new NotificationManager();
