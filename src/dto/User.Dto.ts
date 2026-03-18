export interface UpdateUserDto {
    fullName?: string;
    phoneNumber?: string;
    email?: string;
    role?: string;
    isActive?: boolean;
    username?: string;
    laborContract?: any[];
}

export interface CreateUserDto {
    username: string;
    password?: string;
    email: string;
    fullName: string;
    phoneNumber: string;
    role?: string;
}
