import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString, IsBoolean, IsNumber } from "class-validator";
import { TaskStatus, PerformerType } from "../entity/Enums";

export class CreateTaskDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên task không được để trống" })
    name: string;

    @IsString()
    @IsNotEmpty({ message: "ID dự án không được để trống" })
    projectId: string;

    @IsString()
    @IsOptional()
    jobId?: string;

    @IsString()
    @IsOptional()
    assigneeId?: string;

    @IsEnum(PerformerType)
    @IsOptional()
    performerType?: PerformerType;

    @IsDateString()
    @IsOptional()
    deadline?: string;

    @IsBoolean()
    @IsOptional()
    isOutput?: boolean;
}

export class UpdateTaskStatusDTO {
    @IsEnum(TaskStatus)
    @IsNotEmpty({ message: "Trạng thái không được để trống" })
    status: TaskStatus;

    @IsString()
    @IsOptional()
    result?: string;
}

export class TaskAssignmentDTO {
    @IsString()
    @IsNotEmpty({ message: "ID người thực hiện không được để trống" })
    assigneeId: string;
}
