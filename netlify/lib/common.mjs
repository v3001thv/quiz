import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

// Все попытки прохождения теста лежат в хранилище Netlify Blobs "quiz-attempts":
// один ключ = одна попытка (JSON).
export function attempts() {
  return getStore({ name: "quiz-attempts", consistency: "strong" });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Пароль администратора. В коде хранится только его SHA-256-хэш (не сам пароль).
// Чтобы сменить пароль, задайте переменную окружения ADMIN_PASSWORD в настройках сайта на Netlify.
const DEFAULT_ADMIN_HASH = "26b2bf49b7a695c1fccc01fa3eff4a90c8eb88bb73ed7df15ddf7b8dc20cbf94";

const sha256 = (s) => createHash("sha256").update(String(s), "utf8").digest();

export function isAdmin(password) {
  if (typeof password !== "string" || !password) return false;
  const expected = process.env.ADMIN_PASSWORD
    ? sha256(process.env.ADMIN_PASSWORD)
    : Buffer.from(DEFAULT_ADMIN_HASH, "hex");
  return timingSafeEqual(sha256(password), expected);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Оценка по 10-балльной шкале: доля правильных × 10, округление до целого
export function gradeFrom(correct, total) {
  return Math.round((correct / total) * 10);
}

// Что из записи можно показать самому участнику
export function publicResult(rec) {
  return {
    name: rec.name,
    status: rec.status,
    total: rec.total,
    answered: rec.answered,
    correct: rec.correct,
    percent: rec.percent,
    grade: rec.grade,
    durationSec: rec.durationSec,
    timedOut: rec.status === "timeout",
  };
}
