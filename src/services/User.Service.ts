import { AppDataSource } from "../data-source";
import { Users } from "../entity/User.entity";
import { Accounts } from "../entity/Account.entity";
import { encrypt } from "../helpers/helpers";

export class UserService {
    private userRepository = AppDataSource.getRepository(Users);
    private accountRepository = AppDataSource.getRepository(Accounts);

    async getAll() {
        return await this.userRepository.find({
            relations: ["tasks", "account"],
            select: {
                id: true,
                fullName: true,
                phoneNumber: true,
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
    }

    async getOne(id: string) {
        const user = await this.userRepository.findOne({
            where: { id },
            relations: ["tasks", "account"],
            select: {
                id: true,
                fullName: true,
                phoneNumber: true,
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
        if (!user) throw new Error("Không tìm thấy người dùng");
        return user;
    }

    async create(data: any) {
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
            await transactionalEntityManager.save(user);
        });

        return { message: "Tạo người dùng thành công" };
    }

    async update(id: string, data: any) {
        const user = await this.getOne(id);
        const { fullName, phoneNumber, email, role, isActive, username } = data;

        if (fullName !== undefined) user.fullName = fullName;
        if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;

        if (user.account) {
            if (email !== undefined) user.account.email = email;
            if (role !== undefined) user.account.role = role;
            if (isActive !== undefined) user.account.isActive = isActive;
            if (username !== undefined) user.account.username = username;

            await this.accountRepository.save(user.account);
        }

        return await this.userRepository.save(user);
    }

    async delete(id: string) {
        const user = await this.getOne(id);

        await AppDataSource.transaction(async (transactionalEntityManager) => {
            if (user.account) {
                await transactionalEntityManager.remove(user.account);
            }
            await transactionalEntityManager.remove(user);
        });

        return { message: "Xóa người dùng thành công" };
    }
}
