import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Users } from "../entity/User.entity";

export class AccountService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);

    async getAllAccounts() {
        return await this.accountRepository.find({
            relations: ["user"],
            order: { createdAt: "DESC" }
        });
    }

    async getAccountById(id: string) {
        const account = await this.accountRepository.findOne({
            where: { id },
            relations: ["user"]
        });

        if (!account) {
            throw new Error("Không tìm thấy tài khoản");
        }

        return account;
    }

    async updateAccount(id: string, data: any) {
        const account = await this.accountRepository.findOne({
            where: { id },
            relations: ["user"]
        });

        if (!account) {
            throw new Error("Không tìm thấy tài khoản");
        }

        const { username, email, role, fullName, phoneNumber, isActive } = data;

        // Update Account fields
        if (username !== undefined) account.username = username;
        if (email !== undefined) account.email = email;
        if (role !== undefined) account.role = role;
        if (isActive !== undefined) account.isActive = isActive;

        // Update linked User fields if they exist
        await AppDataSource.transaction(async (transactionalEntityManager) => {
            if (account.user) {
                if (fullName !== undefined) account.user.fullName = fullName;
                if (phoneNumber !== undefined) account.user.phoneNumber = phoneNumber;
                await transactionalEntityManager.save(account.user);
            }
            await transactionalEntityManager.save(account);
        });

        return account;
    }

    async softDeleteAccount(id: string) {
        const account = await this.accountRepository.findOne({ where: { id } });

        if (!account) {
            throw new Error("Không tìm thấy tài khoản");
        }

        account.isActive = false;
        return await this.accountRepository.save(account);
    }
}
