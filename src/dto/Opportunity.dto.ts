import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsNumber, IsArray, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";
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

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    region?: string[];

    @IsString()
    @IsOptional()
    source?: string;

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
    @ValidateIf(o => o.leadEmail !== "" && o.leadEmail !== null && o.leadEmail !== undefined)
    leadEmail?: string;

    @IsString()
    @IsOptional()
    leadAddress?: string;

    @IsString()
    @IsOptional()
    leadTaxId?: string;

    @IsString()
    @IsOptional()
    referralPartnerId?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    expectedRevenue?: number;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    budget?: number;

    @IsString()
    @IsOptional()
    startDate?: string;

    @IsString()
    @IsOptional()
    endDate?: string;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    durationMonths?: number;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    successChance?: number;

    @IsArray()
    @IsOptional()
    services?: any[];

    @IsArray()
    @IsOptional()
    packages?: any[];

    @IsArray()
    @IsOptional()
    attachments?: any[];
}

export class UpdateOpportunityDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsEnum(OpportunityStatus)
    @IsOptional()
    status?: OpportunityStatus;

    @IsEnum(CustomerType)
    @IsOptional()
    customerType?: CustomerType;

    @IsString()
    @IsOptional()
    field?: string;

    @IsString()
    @IsOptional()
    priority?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    region?: string[];

    @IsString()
    @IsOptional()
    source?: string;

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
    @ValidateIf(o => o.leadEmail !== "" && o.leadEmail !== null && o.leadEmail !== undefined)
    leadEmail?: string;

    @IsString()
    @IsOptional()
    leadAddress?: string;

    @IsString()
    @IsOptional()
    leadTaxId?: string;

    @IsString()
    @IsOptional()
    referralPartnerId?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    expectedRevenue?: number;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    budget?: number;

    @IsString()
    @IsOptional()
    startDate?: string;

    @IsString()
    @IsOptional()
    endDate?: string;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    durationMonths?: number;

    @Transform(({ value }) => Number(value))
    @IsNumber()
    @IsOptional()
    successChance?: number;

    @IsArray()
    @IsOptional()
    services?: any[];

    @IsArray()
    @IsOptional()
    packages?: any[];

    @IsArray()
    @IsOptional()
    attachments?: any[];
}
