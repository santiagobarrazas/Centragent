import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DEFAULT_MASTER_USER_ID } from "@centragent/shared";
import { prisma } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const masterUserId = process.env.MASTER_USER_ID ?? DEFAULT_MASTER_USER_ID;
const masterUserName = process.env.MASTER_USER_NAME ?? "Local Master";

await prisma.user.upsert({
  where: { id: masterUserId },
  update: {
    name: masterUserName
  },
  create: {
    id: masterUserId,
    name: masterUserName,
    email: null
  }
});

console.log(`Seeded singleton master user ${masterUserName} (${masterUserId})`);

await prisma.$disconnect();
