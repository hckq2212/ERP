import { TenantContext } from "../context/TenantContext";

const DEFAULT_COMPANY_FOLDER = "GETVINI";

const sanitizeCloudinarySegment = (value: string) => {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || DEFAULT_COMPANY_FOLDER;
};

export const getCompanyCloudinaryFolder = () => {
    const company = TenantContext.getCompany();
    return sanitizeCloudinarySegment(company?.name || DEFAULT_COMPANY_FOLDER);
};

export const getTenantCloudinaryFolder = (folder?: string) => {
    const companyFolder = getCompanyCloudinaryFolder();
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
