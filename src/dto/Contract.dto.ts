import { IsString, IsNotEmpty, IsOptional, IsNumber, IsEnum, IsArray, IsUrl, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ContractStatus, PartnerCommissionStatus } from "../entity/Contract.entity";

export class CreateContractDTO {
    @IsString()
    @IsOptional()
    contractCode?: string;

    @IsString()
    @IsNotEmpty({ message: "Tên hợp đồng không được để trống" })
    name: string;

    @IsString()
    @IsOptional()
    opportunityId?: string;

    @IsString()
    @IsOptional()
    customerId?: string;

    @IsNumber()
    @IsOptional()
    sellingPrice?: number;

    @IsNumber()
    @IsOptional()
    cost?: number;

    @IsEnum(ContractStatus)
    @IsOptional()
    status?: ContractStatus;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    referralPartnerId?: string;
}

export class UpdateContractDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsNumber()
    @IsOptional()
    sellingPrice?: number;

    @IsNumber()
    @IsOptional()
    cost?: number;

    @IsEnum(ContractStatus)
    @IsOptional()
    status?: ContractStatus;

    @IsString()
    @IsOptional()
    description?: string;

    @IsOptional()
    @IsArray()
    attachments?: any[];
}

export class ContractResponseDTO {
    id: string;
    contractCode: string;
    name: string;
    status: ContractStatus;
    sellingPrice: number;
    cost: number;
    createdAt: Date;
    // ... add more fields as needed for the response
}
