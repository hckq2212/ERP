import { Repository } from "typeorm";
import { TenantContext } from "../context/TenantContext";

let isInstalled = false;

const TENANT_METHODS = ["find", "findOne", "findAndCount", "count", "exists"] as const;
const TENANT_BY_METHODS = ["findBy", "findOneBy", "findAndCountBy", "countBy", "existsBy", "delete", "softDelete", "restore"] as const;

function repositoryHasCompany(repo: Repository<any>) {
    return repo.metadata?.relations?.some((relation) => relation.propertyName === "company");
}

function withCompanyWhere(where: any, companyId: string): any {
    if (!where) {
        return { company: { id: companyId } };
    }

    if (Array.isArray(where)) {
        return where.map((item) => withCompanyWhere(item, companyId));
    }

    if (typeof where === "object" && !("company" in where)) {
        return { ...where, company: { id: companyId } };
    }

    return where;
}

function withTenantOptions(repo: Repository<any>, options: any) {
    const company = TenantContext.getCompany();
    if (!company || !repositoryHasCompany(repo)) {
        return options;
    }

    return {
        ...(options || {}),
        where: withCompanyWhere(options?.where, company.id)
    };
}

function withTenantWhere(repo: Repository<any>, where: any) {
    const company = TenantContext.getCompany();
    if (!company || !repositoryHasCompany(repo)) {
        return where;
    }

    if (typeof where === "string" || typeof where === "number") {
        return { id: where, company: { id: company.id } };
    }

    return withCompanyWhere(where, company.id);
}

function assignCompany(repo: Repository<any>, entity: any) {
    const company = TenantContext.getCompany();
    if (!company || !repositoryHasCompany(repo) || !entity || Array.isArray(entity)) {
        return entity;
    }

    if (!entity.company) {
        entity.company = { id: company.id };
    }

    return entity;
}

function isEntityInstance(repo: Repository<any>, entity: any) {
    return typeof repo.metadata.target === "function" && entity instanceof repo.metadata.target;
}

function normalizeForSave(repo: Repository<any>, entity: any) {
    if (!entity || isEntityInstance(repo, entity)) {
        return assignCompany(repo, entity);
    }

    return assignCompany(repo, repo.create(entity));
}

export function installTenantRepositoryGuard() {
    if (isInstalled) return;
    isInstalled = true;

    for (const method of TENANT_METHODS) {
        const original = (Repository.prototype as any)[method];
        (Repository.prototype as any)[method] = function patchedTenantMethod(options: any) {
            return original.call(this, withTenantOptions(this, options));
        };
    }

    for (const method of TENANT_BY_METHODS) {
        const original = (Repository.prototype as any)[method];
        (Repository.prototype as any)[method] = function patchedTenantByMethod(where: any) {
            return original.call(this, withTenantWhere(this, where));
        };
    }

    const originalUpdate = Repository.prototype.update as any;
    (Repository.prototype as any).update = function patchedUpdate(criteria: any, partialEntity: any) {
        return originalUpdate.call(this, withTenantWhere(this, criteria), partialEntity);
    };

    const originalCreate = Repository.prototype.create as any;
    (Repository.prototype as any).create = function patchedCreate(entityLike: any) {
        if (Array.isArray(entityLike)) {
            return originalCreate.call(this, entityLike.map((item) => assignCompany(this, item)));
        }
        return originalCreate.call(this, assignCompany(this, entityLike));
    };

    const originalSave = Repository.prototype.save as any;
    (Repository.prototype as any).save = function patchedSave(entityOrEntities: any, options?: any) {
        if (Array.isArray(entityOrEntities)) {
            entityOrEntities = entityOrEntities.map((item) => normalizeForSave(this, item));
        } else {
            entityOrEntities = normalizeForSave(this, entityOrEntities);
        }
        return originalSave.call(this, entityOrEntities, options);
    };
}
