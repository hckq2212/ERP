import { Users } from "../entity/User.entity";
import { Accounts } from "../entity/Account.entity";
import { encrypt } from "../helpers/helpers";
import { validateUserData } from "../validations/User.Validation";
import { AppDataSource } from "../data-source";
import { RedisService } from "./Redis.Service";
import { TenantContext } from "../context/TenantContext";
import { CompanyMemberRole, CompanyMembers } from "../entity/CompanyMember.entity";


export class UserService {
    private userRepository = AppDataSource.getRepository(Users);
    private accountRepository = AppDataSource.getRepository(Accounts);

    private getCompanyId() {
        return TenantContext.getCompany()?.id;
    }

    private getCacheKey(key: string) {
        const companyId = this.getCompanyId();
        return companyId ? `${key}:company_${companyId}` : key;
    }

    private getTenantUserQuery(companyId: string) {
        return this.userRepository.createQueryBuilder("user")
            .innerJoin(
                "user.companyMemberships",
                "companyMember",
                "companyMember.companyId = :companyId",
                { companyId }
            )
            .leftJoin("user.account", "account")
            .leftJoin("user.tasks", "task", "task.companyId = :companyId", { companyId })
            .select([
                "user.id",
                "user.fullName",
                "user.phoneNumber",
                "user.laborContract",
                "account.id",
                "account.username",
                "account.email",
                "account.role",
                "account.isActive",
                "task.id",
                "task.code",
                "task.name",
                "task.status"
            ]);
    }

    async getAll() {
        const companyId = this.getCompanyId();
        return await RedisService.fetchWithCache(this.getCacheKey('users:all'), 3600, async () => {
            if (companyId) {
                return await this.getTenantUserQuery(companyId).getMany();
            }

            return await this.userRepository.find({
                relations: ["tasks", "account"],
                select: {
                    id: true,
                    fullName: true,
                    phoneNumber: true,
                    laborContract: true,
                    account: {
                        id: true,
                        username: true,
                        email: true,
                        role: true
                    },
                    tasks: {
                        id: true,
                        code: true,
                        name: true,
                        status: true
                    }
                }
            });
        });
    }

    async getOne(id: string) {
        const companyId = this.getCompanyId();
        const user = await RedisService.fetchWithCache(this.getCacheKey(`users:detail:${id}`), 3600, async () => {
            if (companyId) {
                return await this.getTenantUserQuery(companyId)
                    .andWhere("user.id = :id", { id })
                    .getOne();
            }

            return await this.userRepository.findOne({
                where: { id },
                relations: ["tasks", "account"],
                select: {
                    id: true,
                    fullName: true,
                    phoneNumber: true,
                    laborContract: true,
                    account: {
                        id: true,
                        username: true,
                        email: true,
                        role: true
                    },
                    tasks: {
                        id: true,
                        code: true,
                        name: true,
                        status: true
                    }
                }
            });
        });

        if (!user) throw new Error("Không tìm thấy người dùng");
        return user;
    }

    async create(data: any) {
        validateUserData(data);
        const { username, password, email, fullName, phoneNumber, role } = data;

        const existingAccount = await this.accountRepository.findOne({
            where: [{ username }, { email }]
        });

        if (existingAccount) {
            throw new Error("Tên đăng nhập hoặc email đã tồn tại");
        }

        const hashedPassword = await encrypt.encryptPassword(password || "123456");

        const account = new Accounts();
        account.username = username;
        account.password = hashedPassword;
        account.email = email;
        account.role = role || "MEMBER";

        const user = new Users();
        user.fullName = fullName;
        user.phoneNumber = phoneNumber;

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            const savedAccount = await transactionalEntityManager.save(account);
            user.account = savedAccount;
            const savedUser = await transactionalEntityManager.save(user);

            const company = TenantContext.getCompany();
            if (company) {
                const companyMember = transactionalEntityManager.create(CompanyMembers, {
                    company,
                    companyId: company.id,
                    user: savedUser,
                    userId: savedUser.id,
                    role: CompanyMemberRole.MEMBER
                });
                await transactionalEntityManager.save(companyMember);
            }
        });

        // Xóa cache danh sách khi có user mới
        await RedisService.deleteCache(this.getCacheKey('users:all'));

        return { message: "Tạo người dùng thành công" };
    }

    async update(id: string, data: any) {
        validateUserData(data);
        const user = await this.getOne(id);
        const { fullName, phoneNumber, email, role, isActive, username } = data;

        if (fullName !== undefined) user.fullName = fullName;
        if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
        if (data.laborContract !== undefined) user.laborContract = data.laborContract;

        if (user.account) {
            if (email !== undefined) user.account.email = email;
            if (role !== undefined) user.account.role = role;
            if (isActive !== undefined) user.account.isActive = isActive;
            if (username !== undefined) user.account.username = username;

            await this.accountRepository.save(user.account);
        }

        const savedUser = await this.userRepository.save(user);

        // Xóa cache danh sách và cache chi tiết của user vừa update
        await RedisService.deleteCache(this.getCacheKey('users:all'));
        await RedisService.deleteCache(this.getCacheKey(`users:detail:${id}`));

        return savedUser;
    }

    async updateLaborContracts(id: string, laborContract: any[]) {
        const user = await this.getOne(id);
        user.laborContract = laborContract || [];
        const savedUser = await this.userRepository.save(user);

        // Xóa cache danh sách và cache chi tiết của user vừa update
        await RedisService.deleteCache(this.getCacheKey('users:all'));
        await RedisService.deleteCache(this.getCacheKey(`users:detail:${id}`));

        return savedUser;
    }

    async delete(id: string) {
        const user = await this.getOne(id);
        const companyId = this.getCompanyId();

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            if (companyId) {
                const memberRepository = transactionalEntityManager.getRepository(CompanyMembers);
                const membershipCount = await memberRepository
                    .createQueryBuilder("membership")
                    .where("membership.userId = :userId", { userId: id })
                    .getCount();

                if (membershipCount > 1) {
                    await memberRepository.delete({ companyId, userId: id });
                    return;
                }
            }

            if (user.account) {
                await transactionalEntityManager.remove(user.account);
            }
            await transactionalEntityManager.remove(user);
        });

        // Xóa cache danh sách và cache chi tiết của user vừa xóa
        await RedisService.deleteCache(this.getCacheKey('users:all'));
        await RedisService.deleteCache(this.getCacheKey(`users:detail:${id}`));

        return { message: "Xóa người dùng thành công" };
    }
}
