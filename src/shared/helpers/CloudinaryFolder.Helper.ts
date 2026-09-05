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
    const cleanFolder = (folder || "ERP/others").replace(/^\/+|\/+$/g, "");

    if (!cleanFolder) {
        return `${companyFolder}/ERP/others`;
    }

    if (cleanFolder === companyFolder || cleanFolder.startsWith(`${companyFolder}/`)) {
        return cleanFolder;
    }

    const [, ...pathWithoutLegacyCompany] = cleanFolder.split("/");
    if (cleanFolder === DEFAULT_COMPANY_FOLDER || cleanFolder.startsWith(`${DEFAULT_COMPANY_FOLDER}/`)) {
        return [companyFolder, ...pathWithoutLegacyCompany].join("/");
    }

    return `${companyFolder}/${cleanFolder}`;
};
