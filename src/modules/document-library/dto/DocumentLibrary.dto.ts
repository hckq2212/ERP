import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, IsDateString } from "class-validator";

export class UpdateDocumentDTO {
    @IsString()
    @IsNotEmpty({ message: "Tên hiển thị không được để trống" })
    displayName: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @IsOptional()
    tags?: string[];
}

export class FindDocumentsQueryDTO {
    @IsString()
    @IsOptional()
    search?: string;

    @IsString()
    @IsOptional()
    category?: string;

    @IsString()
    @IsOptional()
    tags?: string;

    @IsString()
    @IsOptional()
    uploadedById?: string;

    @IsDateString()
    @IsOptional()
    fromDate?: string;

    @IsDateString()
    @IsOptional()
    toDate?: string;

    @IsIn(["newest", "oldest", "displayName", "mostDownloaded"])
    @IsOptional()
    sort?: string;
}
