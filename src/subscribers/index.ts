import { initModuleSubscribers } from "./ModuleSubscribers";
import { initNotionSubscriber } from "./NotionSubscriber";

/**
 * Entry point for all event subscribers in the system.
 */
export const initSubscribers = () => {
    initModuleSubscribers();
    initNotionSubscriber();
    // Future expansion: initAnalyticsSubscribers(), initAuditSubscribers(), etc.
};
