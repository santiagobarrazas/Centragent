import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DEFAULT_MASTER_USER_ID } from "@centragent/shared";
import { prisma } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

// The local owner is a real User row (isLocalOwner = true). Its id is kept
// stable via MASTER_USER_ID so tokens, projects, and agents attach durably and
// real accounts can be added later without a migration. Projects/agents/tokens
// are created by the API bootstrap and the launcher, not here.
const ownerId = process.env.MASTER_USER_ID ?? DEFAULT_MASTER_USER_ID;
const ownerName = process.env.MASTER_USER_NAME ?? "Local Owner";

await prisma.user.upsert({
  where: { id: ownerId },
  update: { name: ownerName, isLocalOwner: true },
  create: {
    id: ownerId,
    name: ownerName,
    email: null,
    isLocalOwner: true,
    avatarColor: "#6366f1"
  }
});

console.log(`Seeded local owner ${ownerName} (${ownerId})`);

await prisma.$disconnect();
