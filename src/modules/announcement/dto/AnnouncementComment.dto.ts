import { IsString, IsNotEmpty } from "class-validator"

export class CreateAnnouncementCommentDTO {
    @IsString()
    @IsNotEmpty({ message: "Nội dung bình luận không được để trống" })
    content: string
}
