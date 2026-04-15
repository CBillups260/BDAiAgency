import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

/** Resolve .env from project root — not cwd — so GHL and other keys load when the server starts from any directory. */
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local") });
