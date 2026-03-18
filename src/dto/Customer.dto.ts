import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum } from "class-validator";
import { CustomerSource } from "../entity/Customer.entity";

export class CreateCustomerDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên khách hàng không được để trống" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "Số điện thoại không được để trống" })
    phone: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
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

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    taxId?: string;
}
