import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import { Users } from "../entity/User.entity";
import { encrypt } from "../helpers/helpers";
import { VinicoinService } from "./Vinicoin.Service";

export class ProfileService {
    private accountRepository = AppDataSource.getRepository(Accounts);
    private userRepository = AppDataSource.getRepository(Users);
    private vinicoinService = new VinicoinService();

    async getProfile(accountId: string) {
        const account = await this.accountRepository.findOne({
            where: { id: accountId },
            relations: ["user"]
        });

        if (!account) throw new Error("Không tìm thấy tài khoản");

        const vinicoinBalance = await this.vinicoinService.getBalance(account.id);

        return {
            id: account.user?.id,
            accountId: account.id,
            fullName: account.user?.fullName,
            phoneNumber: account.user?.phoneNumber,
            username: account.username,
            email: account.email,
            role: account.role,
            vinicoin: vinicoinBalance.vinicoin,
            vinicoinTotal: vinicoinBalance.vinicoinTotal,
            vinicoinWithdrawn: vinicoinBalance.vinicoinWithdrawn
        };
    }

    async getVinicoinTransactions(accountId: string, filters: { page?: number, limit?: number } = {}) {
        return this.vinicoinService.getTransactions(accountId, filters);
    }

    async updateProfile(accountId: string, data: any) {
        const account = await this.accountRepository.findOne({
            where: { id: accountId },
            relations: ["user"]
        });

        if (!account) throw new Error("Không tìm thấy tài khoản");

        const { fullName, phoneNumber, email, password } = data;

        // 1. Update Password if provided
        if (password) {
            account.password = await encrypt.encryptPassword(password);
        }

        // 2. Update Account fields
        if (email) {
            // Check if email taken by other account
            const existing = await this.accountRepository.findOne({ where: { email } });
            if (existing && existing.id !== account.id) {
                throw new Error("Email đã được sử dụng bởi tài khoản khác");
            }
            account.email = email;
        }

        // 3. Update User fields
        await AppDataSource.transaction(async (transactionalEntityManager) => {
            if (account.user) {
                if (fullName) account.user.fullName = fullName;
                if (phoneNumber) account.user.phoneNumber = phoneNumber;
                await transactionalEntityManager.save(account.user);
            }
            await transactionalEntityManager.save(account);
        });

        return this.getProfile(accountId);
    }
}
