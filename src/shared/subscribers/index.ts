import { initModuleSubscribers } from "./ModuleSubscribers";

/**
 * Entry point for all event subscribers in the system.
 */
export const initSubscribers = () => {
    initModuleSubscribers();
    // Future expansion: initAnalyticsSubscribers(), initAuditSubscribers(), etc.
};
