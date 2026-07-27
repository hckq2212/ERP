import { AppDataSource } from "../data-source";
import { Companies } from "../entity/Company.entity";
import { CompanyMemberRole, CompanyMembers } from "../entity/CompanyMember.entity";
import { Users } from "../entity/User.entity";

const seedCompanies = [
    { name: "GETVINI", slug: "getvini", subdomain: "getvini" },
    { name: "Chuck Motion", slug: "chuck-motion", subdomain: "chuck-motion" },
];

export async function seedCompaniesAndDefaultMemberships() {
    const companyRepo = AppDataSource.getRepository(Companies);
    const userRepo = AppDataSource.getRepository(Users);
    const memberRepo = AppDataSource.getRepository(CompanyMembers);

    for (const seedCompany of seedCompanies) {
        let company = await companyRepo.findOne({ where: { slug: seedCompany.slug } });
        if (!company) {
            company = companyRepo.create(seedCompany);
        } else {
            Object.assign(company, seedCompany);
        }
        await companyRepo.save(company);
    }

    const getvini = await companyRepo.findOneOrFail({ where: { slug: "getvini" } });
    const users = await userRepo.find();

    for (const user of users) {
        const existing = await memberRepo.findOne({
            where: {
                company: { id: getvini.id },
                user: { id: user.id }
            }
        });

        if (!existing) {
            await memberRepo.save(memberRepo.create({
                company: getvini,
                user,
                role: CompanyMemberRole.MEMBER
            }));
        }
    }

    for (const metadata of AppDataSource.entityMetadatas) {
        const hasCompanyRelation = metadata.relations.some((relation) => relation.propertyName === "company");
        if (!hasCompanyRelation || metadata.target === CompanyMembers) {
            continue;
        }

        await AppDataSource.query(
            `UPDATE "${metadata.tableName}" SET "companyId" = $1 WHERE "companyId" IS NULL`,
            [getvini.id]
        );
    }
}
