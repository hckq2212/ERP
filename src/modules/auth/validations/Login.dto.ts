import { IsBoolean, IsString, Length, Matches, ValidateIf } from "class-validator";

export class LoginDto {
    @IsString()
    @Length(1, 254)
    @Matches(/\S/)
    username: string;

    @IsString()
    @Length(1, 128)
    password: string;

    @ValidateIf((_body, value) => value !== undefined)
    @IsBoolean()
    rememberMe?: boolean;
}
