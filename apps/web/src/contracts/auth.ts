import { z } from "zod"
import { idSchema } from "./common"
export const returnPathSchema = z.string().max(2048).refine(path => {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\s\u0000-\u001f]/.test(path) || /%(?:2f|5c|0[ad])/i.test(path)) return false
  const pathname = path.split(/[?#]/)[0]
  return pathname === "/" || ["/calendar", "/book", "/requests", "/settings", "/onboarding"].some(p => pathname === p || pathname.startsWith(p + "/"))
}, "앱 내부의 복귀 경로를 지정해 주세요")
export const authStartSchema = z.strictObject({ purpose: z.enum(["login", "calendar"]), returnPath: returnPathSchema })
export type AuthStartInput = z.infer<typeof authStartSchema>
export type AuthStartView = { authorizationUrl: string }
export const authCallbackSchema = z.strictObject({ code: z.string().min(1).max(4096), state: z.string().min(1).max(512) })
export type AuthCallbackInput = z.infer<typeof authCallbackSchema>
export type AuthCallbackResult = { returnPath: string }
export const actorSchema = z.strictObject({ id: idSchema, name: z.string(), mode: z.enum(["demo", "real"]) })
export type Actor = z.infer<typeof actorSchema>
