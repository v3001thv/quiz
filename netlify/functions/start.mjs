import { randomUUID } from "node:crypto";
import { attempts, json, readBody } from "../lib/common.mjs";
import { QUESTIONS, TIME_LIMIT_SEC, publicQuestions } from "../lib/questions.mjs";

// POST /api/start  { name }  →  создаёт попытку и запускает таймер на сервере
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  const body = await readBody(req);
  const name = String(body?.name ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (name.length < 2) return json({ error: "Введите имя — хотя бы 2 символа" }, 400);

  const id = randomUUID();
  const startedAt = Date.now();
  await attempts().setJSON(id, {
    id,
    name,
    startedAt,
    status: "in_progress",
    total: QUESTIONS.length,
  });

  return json({
    attemptId: id,
    name,
    startedAt,
    serverNow: Date.now(),
    limitSec: TIME_LIMIT_SEC,
    questions: publicQuestions(),
  });
};

export const config = { path: "/api/start" };
