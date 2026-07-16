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
type NewNotificationEvent = {
    companyId?: string;
    recipientId: string;
    notification: any;
};

type ModuleEvent = {
    companyId?: string;
    recipientId?: string;
    event: string;
    payload: any;
};

class NotificationManager {
    private connections = new Map<string, Map<string, Response[]>>();

    constructor() {
        // REGISTER SINGLETON LISTENER for Persistent Notifications
        notificationEmitter.on(NOTIFICATION_EVENTS.NEW_NOTIFICATION, (data: NewNotificationEvent) => {
            if (!data.companyId) {
                console.warn(`[SSE] Skipped notification without companyId for recipient ${data.recipientId}`);
                return;
            }
            this.broadcastToUser(data.companyId, data.recipientId, data.notification);
        });

        // REGISTER SINGLETON LISTENER for Transient Module Events
        notificationEmitter.on(NOTIFICATION_EVENTS.MODULE_EVENT, (data: ModuleEvent) => {
            if (!data.companyId) {
                console.warn(`[SSE] Skipped module event without companyId: ${data.event}`);
                return;
            }

            const wrappedPayload = {
                __isModuleEvent: true,
                event: data.event,
                data: data.payload
            };

            if (data.recipientId) {
                console.log(`[SSE] Tenant broadcast to ${data.companyId}:${data.recipientId} for event ${data.event}`);
                this.broadcastToUser(data.companyId, data.recipientId, wrappedPayload);
            } else {
                const connectionCount = this.getCompanyConnectionCount(data.companyId);
                console.log(`[SSE] Company broadcast for event ${data.event} to ${connectionCount} active connections`);
                this.broadcastToCompany(data.companyId, wrappedPayload);
            }
        });
    }

    addConnection(companyId: string, userId: string, res: Response) {
        const companyConnections = this.connections.get(companyId) || new Map<string, Response[]>();
        const userConnections = companyConnections.get(userId) || [];
        userConnections.push(res);
        companyConnections.set(userId, userConnections);
        this.connections.set(companyId, companyConnections);
    }

    removeConnection(companyId: string, userId: string, res: Response) {
        const companyConnections = this.connections.get(companyId);
        if (!companyConnections) return;

        let userConnections = companyConnections.get(userId) || [];
        userConnections = userConnections.filter(c => c !== res);

        if (userConnections.length === 0) {
            companyConnections.delete(userId);
        } else {
            companyConnections.set(userId, userConnections);
        }

        if (companyConnections.size === 0) {
            this.connections.delete(companyId);
        }
    }

    broadcastToUser(companyId: string, recipientId: string, payload: any, sseEvent?: string) {
        const userConnections = this.connections.get(companyId)?.get(recipientId);
        if (userConnections) {
            this.writeToConnections(userConnections, payload, sseEvent);
        }
    }

    broadcastToCompany(companyId: string, payload: any, sseEvent?: string) {
        const companyConnections = this.connections.get(companyId);
        if (!companyConnections) return;

        for (const userConnections of companyConnections.values()) {
            this.writeToConnections(userConnections, payload, sseEvent);
        }
    }

    private getCompanyConnectionCount(companyId: string) {
        const companyConnections = this.connections.get(companyId);
        if (!companyConnections) return 0;
        let total = 0;
        for (const userConnections of companyConnections.values()) {
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
