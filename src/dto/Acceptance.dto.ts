import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum } from "class-validator";
import { AcceptanceStatus } from "../entity/AcceptanceRequest.entity";

export class CreateAcceptanceDTO {
    @IsString()
    @IsNotEmpty({ message: "ID dự án không được để trống" })
    projectId: string;

    @IsString()
    @IsNotEmpty({ message: "Nội dung nghiệm thu không được để trống" })
    content: string;

    @IsArray()
    @IsOptional()
    attachments?: any[];
}

export class UpdateAcceptanceStatusDTO {
    @IsEnum(AcceptanceStatus)
    @IsNotEmpty({ message: "Trạng thái không được để trống" })
    status: AcceptanceStatus;

    @IsString()
    @IsOptional()
    note?: string;
}
