import { EventEmitter } from "events";

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
