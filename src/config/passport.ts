import passport from "passport";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { AppDataSource } from "../data-source";
import { Accounts } from "../entity/Account.entity";
import * as dotenv from "dotenv";

dotenv.config();

const cookieExtractor = (req: any) => {
    let token = null;
    if (req && req.cookies) {
        token = req.cookies["accessToken"];
    }
    return token;
};

const opts = {
    jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken()
    ]),
    secretOrKey: process.env.JWT_SECRET || ""
};

passport.use(
    new JwtStrategy(opts, async (jwt_payload, done) => {
        try {
            const accountRepository = AppDataSource.getRepository(Accounts);
            const account = await accountRepository.findOne({
                where: { id: jwt_payload.id as string },
                relations: ["user"]
            });

            if (account) {
                return done(null, {
                    id: account.id,
                    userId: account.user?.id,
                    role: account.role,
                    username: account.username
                });
            } else {
                return done(null, false);
            }
        } catch (error) {
            return done(error, false);
        }
    })
);

export default passport;
