export const normalizeNickname = (value?: string | null) => {
    if (value == null) return null;

    const normalized = String(value).trim();
    return normalized || null;
};

export const buildDefaultTaskNickname = (
    job: { nickname?: string | null } | null | undefined,
    sequence: number
) => {
    const jobNickname = normalizeNickname(job?.nickname);
    return jobNickname ? `${jobNickname} ${sequence}` : null;
};
