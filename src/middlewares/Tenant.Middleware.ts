import { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Companies } from "../entity/Company.entity";
import { CompanyMembers } from "../entity/CompanyMember.entity";
import { TenantContext } from "../context/TenantContext";

export const COMPANY_ACCESS_DENIED_MESSAGE = "Bạn không có quyền truy cập công ty này";

export interface TenantRequest extends Request {
    company?: Companies;
    companyMember?: CompanyMembers;
}

export const tenantMiddleware = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
        const companySlug = req.params.companySlug || req.headers["x-company-slug"];

        if (!companySlug || Array.isArray(companySlug)) {
            return res.status(400).json({ message: "Thiếu mã công ty" });
        }

        const company = await AppDataSource.getRepository(Companies).findOne({
            where: { slug: companySlug }
        });

        if (!company) {
            return res.status(404).json({ message: "Không tìm thấy công ty" });
        }

        req.company = company;
        TenantContext.run({ company }, () => next());
    } catch (error) {
        next(error);
    }
};

export const companyMemberMiddleware = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user?.userId;
        const companyId = req.company?.id;

        if (!userId || !companyId) {
            return res.status(403).json({ message: COMPANY_ACCESS_DENIED_MESSAGE });
        }

        const member = await AppDataSource.getRepository(CompanyMembers).findOne({
            where: {
                user: { id: userId },
                company: { id: companyId }
            },
            relations: ["company", "user"]
        });

        if (!member) {
            return res.status(403).json({ message: COMPANY_ACCESS_DENIED_MESSAGE });
        }

        req.companyMember = member;
        TenantContext.setCompanyMember(member);
        next();
    } catch (error) {
        next(error);
    }
};
