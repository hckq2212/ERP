export interface QueryLibraryDto {
    tab: "creative" | "upload";
    type: "all" | "image" | "video" | "audio";
    favorite?: string; // 'true' | undefined — query param luôn là string
}