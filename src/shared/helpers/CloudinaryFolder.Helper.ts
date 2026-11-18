const DEFAULT_COMPANY_FOLDER = "GETVINI";

const sanitizeCloudinarySegment = (value: string) => {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || DEFAULT_COMPANY_FOLDER;
};

export const getDefaultCloudinaryFolder = () => {
    return sanitizeCloudinarySegment(DEFAULT_COMPANY_FOLDER);
};

export const getCloudinaryFolder = (folder?: string) => {
    const companyFolder = getDefaultCloudinaryFolder();

    // Tách thành các segment và loại bỏ triệt để các ký tự path traversal như '..' hoặc '.'
    const rawSegments = (folder || "ERP/others")
        .split("/")
        .map(s => s.trim())
        .filter(s => s && s !== "." && s !== "..");

    const sanitizedSegments = rawSegments.map(s => sanitizeCloudinarySegment(s));
    const cleanFolder = sanitizedSegments.join("/");

    if (!cleanFolder) {
        return `${companyFolder}/ERP/others`;
    }

    if (cleanFolder === companyFolder || cleanFolder.startsWith(`${companyFolder}/`)) {
        return cleanFolder;
    }

    return `${companyFolder}/${cleanFolder}`;
};
