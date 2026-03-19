import { IsString, IsNotEmpty, IsOptional, IsEmail, IsEnum, IsNumber, IsArray, ValidateIf } from "class-validator";
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
    region?: string;

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

    @IsNumber()
    @IsOptional()
    expectedRevenue?: number;

    @IsNumber()
    @IsOptional()
    budget?: number;

    @IsString()
    @IsOptional()
    startDate?: string;

    @IsString()
    @IsOptional()
    endDate?: string;

    @IsNumber()
    @IsOptional()
    durationMonths?: number;

    @IsNumber()
    @IsOptional()
    successChance?: number;

    @IsNumber()
    @IsOptional()
    partnerCommissionRate?: number;

    @IsNumber()
    @IsOptional()
    expectedPartnerCommission?: number;

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

    @IsString()
    @IsOptional()
    region?: string;

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

    @IsNumber()
    @IsOptional()
    expectedRevenue?: number;

    @IsNumber()
    @IsOptional()
    budget?: number;

    @IsString()
    @IsOptional()
    startDate?: string;

    @IsString()
    @IsOptional()
    endDate?: string;

    @IsNumber()
    @IsOptional()
    durationMonths?: number;

    @IsNumber()
    @IsOptional()
    successChance?: number;

    @IsNumber()
    @IsOptional()
    partnerCommissionRate?: number;

    @IsNumber()
    @IsOptional()
    expectedPartnerCommission?: number;

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
