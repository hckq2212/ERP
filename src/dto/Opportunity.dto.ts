import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsNumber, IsArray } from "class-validator";
import { OpportunityStatus, CustomerType } from "../entity/Opportunity.entity";

export class CreateOpportunityDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên cơ hội không được để trống" })
    name: string;

    @IsEnum(CustomerType)
    @IsOptional()
    customerType?: CustomerType;

    @IsString()
    @IsOptional()
    field?: string;

    @IsString()
    @IsOptional()
    priority?: string;

    @IsString()
    @IsOptional()
    customerId?: string;

    @IsString()
    @IsOptional()
    leadName?: string;

    @IsString()
    @IsOptional()
    leadPhone?: string;

    @IsEmail({}, { message: "Email không hợp lệ" })
    @IsOptional()
    leadEmail?: string;

    @IsString()
    @IsOptional()
    leadAddress?: string;

    @IsString()
    @IsOptional()
    referralPartnerId?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @IsOptional()
    services?: {
        serviceId: string;
        quantity: number;
        sellingPrice: number;
    }[];
}

export class UpdateOpportunityDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsEnum(OpportunityStatus)
    @IsOptional()
    status?: OpportunityStatus;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @IsOptional()
    attachments?: any[];
}
