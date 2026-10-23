const CHAT_TOKEN_REGEX = /(@\{([A-Za-z0-9_-]+):([^}]+)\})|(#{([A-Za-z0-9_-]+):([^}]+)})|(@\{([A-Za-z0-9_-]+)\})/g;

export const formatChatPushContent = (content?: string | null, maxLength = 120): string => {
    const friendly = (content || "").replace(
        CHAT_TOKEN_REGEX,
        (_match, userToken, _userId, userDisplay, taskToken, _taskId, taskDisplay, legacyToken, legacyCode) => {
            if (userToken) return `@${userDisplay}`;
            if (taskToken) return `#${taskDisplay}`;
            if (legacyToken) return `#${legacyCode}`;
            return "";
        }
    ).trim();

    return friendly.length > maxLength ? `${friendly.substring(0, maxLength)}...` : friendly;
};

