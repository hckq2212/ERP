import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsBoolean } from "class-validator";
import { UserRole } from "../entity/Account.entity";

export class CreateUserDTO {
    @IsString()
    @IsNotEmpty({ message: "Username không được để trống" })
    username: string;

    @IsString()
    @IsNotEmpty({ message: "Password không được để trống" })
    password: string;

    @IsString()
    @IsNotEmpty({ message: "Họ tên không được để trống" })
    fullName: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @IsEnum(UserRole)
    @IsNotEmpty({ message: "Role không được để trống" })
    role: UserRole;
}

export class UpdateUserDTO {
    @IsString()
    @IsOptional()
    fullName?: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @IsEnum(UserRole)
    @IsOptional()
    role?: UserRole;

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;
}
