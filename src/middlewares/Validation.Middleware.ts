import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { Request, Response, NextFunction } from "express";

/**
 * Middleware to validate request body against a DTO class.
 * @param dtoClass The DTO class to validate against.
 */
export function validationMiddleware(dtoClass: any) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const dtoInstance = plainToInstance(dtoClass, req.body);
        const errors: ValidationError[] = await validate(dtoInstance, {
            whitelist: true, // Automatically remove non-decorated properties
            forbidNonWhitelisted: false, // Don't throw error if non-whitelisted properties are present
        });

        if (errors.length > 0) {
            const errorMessages = errors.map((error: ValidationError) => ({
                property: error.property,
                constraints: error.constraints,
                children: error.children && error.children.length > 0 ? formatErrors(error.children) : undefined
            }));

            return res.status(400).json({
                message: "Dữ liệu không hợp lệ",
                errors: errorMessages
            });
        }

        // Replace request body with the validated and transformed instance
        req.body = dtoInstance;
        next();
    };
}

function formatErrors(errors: ValidationError[]): any[] {
    return errors.map(error => ({
        property: error.property,
        constraints: error.constraints,
        children: error.children && error.children.length > 0 ? formatErrors(error.children) : undefined
    }));
}
