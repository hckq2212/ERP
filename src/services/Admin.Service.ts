import {
    FindOptionsOrder,
    FindOptionsRelations,
    FindOptionsWhere,
    ILike,
    ObjectLiteral,
    Repository
} from "typeorm";
import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Companies } from "../entity/Company.entity";
import { RefreshSessions } from "../entity/RefreshSession.entity";
import { AuthRequest } from "../middlewares/Auth.Middleware";
import { AdminEntityConfig, AdminEntityKey, adminRegistry, adminRegistryList } from "../admin/AdminRegistry";
import { AccountService } from "./Account.Service";

type AdminFieldType = "string" | "number" | "boolean" | "date" | "enum" | "json" | "relation";

interface AdminFieldSchema {
    key: string;
    label: string;
    type: AdminFieldType;
    required: boolean;
    readOnly: boolean;
    hidden: boolean;
    filterable: boolean;
    searchable: boolean;
    enumOptions?: string[];
    relation?: {
        entityKey: string;
        labelFields: string[];
        multiple: boolean;
    };
}

const DEFAULT_LABEL_FIELDS = ["fullName", "name", "title", "username", "email", "slug", "id"];
const RESERVED_QUERY_KEYS = new Set(["page", "limit", "search", "sortBy", "sortOrder"]);

export class AdminService {
    private accountService = new AccountService();

    listEntities() {
        return adminRegistryList.map((config) => ({
            key: config.key,
            label: config.label,
            description: config.description,
            capabilities: {
                create: !config.readOnly,
                update: !config.readOnly,
                delete: !config.readOnly,
                readonly: !!config.readOnly
            }
        }));
    }

    getMe(req: AuthRequest & { company?: Companies }) {
        return {
            id: req.user?.userId,
            accountId: req.user?.id,
            role: req.user?.role,
            username: req.user?.username,
            company: req.company
                ? {
                    id: req.company.id,
                    name: req.company.name,
                    slug: req.company.slug
                }
                : null
        };
    }

    getSchema(entityKey: string) {
        const config = this.getConfig(entityKey);
        const repo = this.getRepository(config);
        const metadata = repo.metadata;
        const relationColumns = new Set(
            metadata.relations.flatMap((relation) => relation.joinColumns.map((column) => column.propertyName))
        );
        const relationEntityKeyByTarget = this.getRelationEntityKeyMap();

        const fields: AdminFieldSchema[] = [];

        for (const column of metadata.columns) {
            const hidden = this.isHiddenField(config, column.propertyName) || relationColumns.has(column.propertyName);
            const readOnly = this.isReadOnlyField(config, column.propertyName);
            fields.push({
                key: column.propertyName,
                label: this.toLabel(column.propertyName),
                type: this.mapColumnType(column.type),
                required: !column.isNullable && !readOnly,
                readOnly,
                hidden,
                filterable: !hidden && !readOnly,
                searchable: config.searchFields.includes(column.propertyName),
                enumOptions: column.enum ? column.enum.map((item: any) => String(item)) : undefined
            });
        }

        for (const relation of metadata.relations) {
            if (relation.isOneToMany || relation.isManyToMany || !relation.isOwning) continue;

            const target = relation.type as Function;
            const relationKey = relationEntityKeyByTarget.get(target.name);
            fields.push({
                key: relation.propertyName,
                label: this.toLabel(relation.propertyName),
                type: "relation",
                required: false,
                readOnly: this.isReadOnlyField(config, relation.propertyName),
                hidden: this.isHiddenField(config, relation.propertyName),
                filterable: !this.isHiddenField(config, relation.propertyName),
                searchable: config.searchFields.includes(relation.propertyName),
                relation: relationKey
                    ? {
                        entityKey: relationKey,
                        labelFields: this.getRelationLabelFields(config, relation.propertyName),
                        multiple: relation.isManyToMany || relation.isOneToMany
                    }
                    : undefined
            });
        }

        const visibleFields = fields.filter((field) => !field.hidden);
        const listFields = (config.listFields || visibleFields.slice(0, 6).map((field) => field.key))
            .filter((field) => visibleFields.some((item) => item.key === field));
        const detailFields = (config.detailFields || visibleFields.map((field) => field.key))
            .filter((field) => visibleFields.some((item) => item.key === field));

        return {
            entity: {
                key: config.key,
                label: config.label,
                description: config.description,
                capabilities: {
                    create: !config.readOnly,
                    update: !config.readOnly,
                    delete: !config.readOnly,
                    readonly: !!config.readOnly
                }
            },
            listFields,
            detailFields,
            fields
        };
    }

    async listRecords(entityKey: string, query: Record<string, any>, req: AuthRequest & { company?: Companies }) {
        const config = this.getConfig(entityKey);
        const repo = this.getRepository(config);
        const schema = this.getSchema(config.key);
        const page = Math.max(Number(query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
        const search = String(query.search || "").trim();
        const order = this.buildOrder(config, schema.fields, String(query.sortBy || "createdAt"), String(query.sortOrder || "DESC"));
        const filters = this.extractFilters(query, schema.fields);
        const relations = this.getReadRelations(config);

        const where = this.buildWhere(config, search, filters, req.company);
        const [records, total] = await repo.findAndCount({
            where,
            relations,
            order,
            skip: (page - 1) * limit,
            take: limit
        });

        return {
            data: records.map((record) => this.serializeRecord(config, record)),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(Math.ceil(total / limit), 1)
            }
        };
    }

    async getRecord(entityKey: string, id: string, reqCompany?: Companies) {
        const config = this.getConfig(entityKey);
        const repo = this.getRepository(config);
        const record = await repo.findOne({
            where: this.mergeWhere(this.getScopeWhere(config, reqCompany), { id }) as FindOptionsWhere<any>,
            relations: this.getReadRelations(config)
        });

        if (!record) {
            throw new Error("Khong tim thay ban ghi");
        }

        return this.serializeRecord(config, record);
    }

    async createRecord(entityKey: string, payload: Record<string, any>) {
        const config = this.getConfig(entityKey);
        if (config.readOnly) {
            throw new Error("Entity nay chi cho phep xem");
        }

        const repo = this.getRepository(config);
        const entity = repo.create(this.normalizePayload(config, payload));
        const saved = await repo.save(entity);
        return this.getRecord(config.key, saved.id);
    }

    async updateRecord(entityKey: string, id: string, payload: Record<string, any>, reqCompany?: Companies) {
        const config = this.getConfig(entityKey);
        if (config.readOnly) {
            throw new Error("Entity nay chi cho phep xem");
        }

        const repo = this.getRepository(config);
        const record = await repo.findOne({
            where: this.mergeWhere(this.getScopeWhere(config, reqCompany), { id }) as FindOptionsWhere<any>,
            relations: this.getWriteRelations(config)
        });

        if (!record) {
            throw new Error("Khong tim thay ban ghi");
        }

        Object.assign(record, this.normalizePayload(config, payload));
        await repo.save(record);
        return this.getRecord(config.key, id, reqCompany);
    }

    async deleteRecord(entityKey: string, id: string, reqCompany?: Companies) {
        const config = this.getConfig(entityKey);
        if (config.readOnly) {
            throw new Error("Entity nay chi cho phep xem");
        }

        const repo = this.getRepository(config);
        const record = await repo.findOne({
            where: this.mergeWhere(this.getScopeWhere(config, reqCompany), { id }) as FindOptionsWhere<any>
        });

        if (!record) {
            throw new Error("Khong tim thay ban ghi");
        }

        if (config.softDeleteField) {
            (record as Record<string, any>)[config.softDeleteField] = false;
            await repo.save(record);
            return { mode: "soft", success: true };
        }

        await repo.remove(record);
        return { mode: "hard", success: true };
    }

    async resetAccountPassword(id: string, newPassword: string, reqCompany?: Companies) {
        const repo = AppDataSource.getRepository(Accounts);
        const account = await repo.findOne({
            where: this.mergeWhere(this.getScopeWhere(adminRegistry.accounts, reqCompany), { id }) as FindOptionsWhere<Accounts>
        });

        if (!account) {
            throw new Error("Khong tim thay tai khoan");
        }

        await this.accountService.resetPassword(id, newPassword);
        return { success: true };
    }

    private getConfig(entityKey: string) {
        const config = adminRegistry[entityKey as AdminEntityKey];
        if (!config) {
            throw new Error("Entity khong duoc ho tro");
        }
        return config;
    }

    private getRepository(config: AdminEntityConfig): Repository<any> {
        return AppDataSource.getRepository(config.target);
    }

    private getReadRelations(config: AdminEntityConfig): FindOptionsRelations<any> {
        const relations: Record<string, boolean> = {};
        for (const relation of this.getRepository(config).metadata.relations) {
            if (relation.isOneToMany || relation.isManyToMany || !relation.isOwning) continue;
            relations[relation.propertyName] = true;
        }
        return relations;
    }

    private getWriteRelations(config: AdminEntityConfig): FindOptionsRelations<any> {
        return this.getReadRelations(config);
    }

    private getScopeWhere(config: AdminEntityConfig, company?: Companies) {
        if (!company) return {};

        switch (config.tenantScope) {
            case "current-company":
                return { id: company.id };
            case "company-memberships":
                if (config.target === Accounts) {
                    return { user: { companyMemberships: { company: { id: company.id } } } };
                }
                if (config.target === RefreshSessions) {
                    return { company: { id: company.id } };
                }
                return { companyMemberships: { company: { id: company.id } } };
            default:
                return {};
        }
    }

    private buildWhere(config: AdminEntityConfig, search: string, filters: Record<string, any>, company?: Companies) {
        const scopeWhere = this.getScopeWhere(config, company);
        const filterWhere = this.buildFilterWhere(config, filters);

        if (!search) {
            return this.mergeWhere(scopeWhere, filterWhere);
        }

        const conditions = config.searchFields.map((path) => {
            const searchCondition = this.pathToWhere(path, ILike(`%${search}%`));
            return this.mergeWhere(scopeWhere, this.mergeWhere(filterWhere, searchCondition));
        });

        return conditions.length ? conditions : this.mergeWhere(scopeWhere, filterWhere);
    }

    private buildFilterWhere(config: AdminEntityConfig, filters: Record<string, any>) {
        const schema = this.getSchema(config.key);
        const fieldMap = new Map(schema.fields.map((field) => [field.key, field]));
        const where: Record<string, any> = {};

        for (const [key, rawValue] of Object.entries(filters)) {
            const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
            if (value === undefined || value === null || value === "") continue;

            const field = fieldMap.get(key);
            if (!field) continue;

            if (field.type === "relation") {
                where[key] = { id: value };
                continue;
            }

            if (field.type === "boolean") {
                where[key] = value === "true" || value === true;
                continue;
            }

            if (field.type === "number") {
                where[key] = Number(value);
                continue;
            }

            if (field.type === "date") {
                where[key] = new Date(String(value));
                continue;
            }

            where[key] = value;
        }

        return where;
    }

    private buildOrder(config: AdminEntityConfig, fields: AdminFieldSchema[], sortBy: string, sortOrder: string) {
        const validField = fields.find((field) => field.key === sortBy && field.type !== "relation");
        const orderField = validField?.key || "createdAt";
        return { [orderField]: sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC" } as FindOptionsOrder<any>;
    }

    private extractFilters(query: Record<string, any>, fields: AdminFieldSchema[]) {
        const fieldNames = new Set(fields.map((field) => field.key));
        const filters: Record<string, any> = {};

        for (const [key, value] of Object.entries(query)) {
            if (RESERVED_QUERY_KEYS.has(key) || !fieldNames.has(key)) continue;
            filters[key] = value;
        }

        return filters;
    }

    private serializeRecord(config: AdminEntityConfig, record: Record<string, any>) {
        const schema = this.getSchema(config.key);
        const output: Record<string, any> = { id: record.id };

        for (const field of schema.fields) {
            if (field.hidden) continue;

            if (field.type === "relation") {
                output[field.key] = this.serializeRelationValue(config, field.key, record[field.key]);
                continue;
            }

            output[field.key] = record[field.key];
        }

        return output;
    }

    private serializeRelationValue(config: AdminEntityConfig, relationName: string, value: any) {
        if (!value) return null;
        if (Array.isArray(value)) {
            return value.map((item) => ({
                id: item?.id,
                label: this.buildRecordLabel(item, this.getRelationLabelFields(config, relationName))
            }));
        }

        return {
            id: value.id,
            label: this.buildRecordLabel(value, this.getRelationLabelFields(config, relationName)),
            raw: this.stripObject(value)
        };
    }

    private normalizePayload(config: AdminEntityConfig, payload: Record<string, any>) {
        const schema = this.getSchema(config.key);
        const normalized: Record<string, any> = {};

        for (const field of schema.fields) {
            if (field.hidden || field.readOnly || payload[field.key] === undefined) continue;
            const value = payload[field.key];

            if (field.type === "relation") {
                if (value === null || value === "") {
                    normalized[field.key] = null;
                } else {
                    normalized[field.key] = { id: typeof value === "object" ? value.id : value };
                }
                continue;
            }

            if (field.type === "number") {
                normalized[field.key] = value === null || value === "" ? null : Number(value);
                continue;
            }

            if (field.type === "boolean") {
                normalized[field.key] = value === true || value === "true";
                continue;
            }

            if (field.type === "date") {
                normalized[field.key] = value ? new Date(value) : null;
                continue;
            }

            normalized[field.key] = value;
        }

        return normalized;
    }

    private getRelationEntityKeyMap() {
        const map = new Map<string, string>();
        for (const config of adminRegistryList) {
            const repo = this.getRepository(config);
            map.set(repo.metadata.targetName, config.key);
        }
        return map;
    }

    private isHiddenField(config: AdminEntityConfig, fieldName: string) {
        return (config.hiddenFields || []).includes(fieldName);
    }

    private isReadOnlyField(config: AdminEntityConfig, fieldName: string) {
        if (config.readOnly) return true;
        if (["id", "createdAt", "updatedAt"].includes(fieldName)) return true;
        return (config.readOnlyFields || []).includes(fieldName);
    }

    private getRelationLabelFields(config: AdminEntityConfig, relationName: string) {
        return config.relationDisplayFields?.[relationName] || DEFAULT_LABEL_FIELDS;
    }

    private toLabel(input: string) {
        return input
            .replace(/([A-Z])/g, " $1")
            .replace(/[_-]+/g, " ")
            .replace(/^\w/, (match) => match.toUpperCase())
            .trim();
    }

    private mapColumnType(columnType: any): AdminFieldType {
        const value = typeof columnType === "string" ? columnType : String(columnType);
        if (value.includes("bool")) return "boolean";
        if (value.includes("int") || value.includes("decimal") || value.includes("float") || value.includes("double")) return "number";
        if (value.includes("date") || value.includes("time")) return "date";
        if (value.includes("json")) return "json";
        if (value === "enum") return "enum";
        return "string";
    }

    private pathToWhere(path: string, value: any) {
        const segments = path.split(".");
        return segments.reduceRight((acc, segment) => ({ [segment]: acc }), value);
    }

    private mergeWhere(base: any, extra: any): any {
        if (!base || Object.keys(base).length === 0) return extra || {};
        if (!extra || Object.keys(extra).length === 0) return base || {};

        const result = { ...base };
        for (const [key, value] of Object.entries(extra)) {
            if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !(value as any)._type) {
                result[key] = this.mergeWhere(result[key], value);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    private buildRecordLabel(record: Record<string, any>, preferredFields: string[]) {
        for (const key of preferredFields) {
            const value = record?.[key];
            if (value !== undefined && value !== null && value !== "") {
                return String(value);
            }
        }
        return String(record?.id || "Unknown");
    }

    private stripObject(value: Record<string, any>) {
        const output: Record<string, any> = {};
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === "function") continue;
            if (item && typeof item === "object") continue;
            output[key] = item;
        }
        return output;
    }
}
