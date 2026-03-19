import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, ValidateIf } from "class-validator";
import { CustomerSource } from "../entity/Customer.entity";

export class CreateCustomerDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên khách hàng không được để trống" })
    name: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    @ValidateIf(o => o.email !== "" && o.email !== null && o.email !== undefined)
    email?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    taxId?: string;

    @IsEnum(CustomerSource)
    @IsOptional()
    source?: CustomerSource;

    @IsString()
    @IsOptional()
    referralPartnerId?: string;
}

export class UpdateCustomerDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    @ValidateIf(o => o.email !== "" && o.email !== null && o.email !== undefined)
    email?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    taxId?: string;
}
