import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString } from "class-validator";
import { ProjectStatus } from "../entity/Project.entity";

export class CreateProjectDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên dự án không được để trống" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "ID hợp đồng không được để trống" })
    contractId: string;

    @IsString()
    @IsNotEmpty({ message: "ID team không được để trống" })
    teamId: string;

    @IsDateString()
    @IsOptional()
    plannedStartDate?: string;

    @IsDateString()
    @IsOptional()
    plannedEndDate?: string;
}

export class UpdateProjectDTO {
    @IsString()
    @IsOptional()
    name?: string;

    @IsEnum(ProjectStatus)
    @IsOptional()
    status?: ProjectStatus;

    @IsDateString()
    @IsOptional()
    plannedStartDate?: string;

    @IsDateString()
    @IsOptional()
    plannedEndDate?: string;

    @IsDateString()
    @IsOptional()
    actualStartDate?: string;

    @IsDateString()
    @IsOptional()
    actualEndDate?: string;
}

export class AssignTeamDTO {
    @IsString()
    @IsNotEmpty({ message: "ID hợp đồng không được để trống" })
    contractId: string;

    @IsString()
    @IsNotEmpty({ message: "ID team không được để trống" })
    teamId: string;

    @IsString()
    @IsOptional()
    name?: string;
}
