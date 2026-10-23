import type { Page } from "@playwright/test";
import { expect, signedInHost, test } from "./support/session";

// The rendered Thyme theme (task 4.7): the paper layer, its omission in print and
// forced colors, fonts, focus outlines and reduced motion.

function paperLayer(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body, "::before");
    return {
      backgroundImage: style.backgroundImage,
      content: style.content,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      position: style.position,
      zIndex: style.zIndex,
    };
  });
}

test("the paper layer sits behind the content, faint and inert", async ({ page, request }) => {
  await page.goto("/");

  expect(await paperLayer(page)).toMatchObject({
    backgroundImage: expect.stringContaining("/paper-grain.svg"),
    opacity: "0.025",
    pointerEvents: "none",
    position: "fixed",
    zIndex: "-1",
  });
  expect((await request.get("/paper-grain.svg")).status()).toBe(200);
  // Content sits on the solid canvas and smooth paper, not on the texture.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(250, 248, 242)");
});

test("the paper layer is omitted in print", async ({ page }) => {
  await page.emulateMedia({ media: "print" });
  await page.goto("/");

  expect(await paperLayer(page)).toMatchObject({ backgroundImage: "none", content: "none" });
});

test("the paper layer is omitted in forced colors", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");

  expect(await paperLayer(page)).toMatchObject({ backgroundImage: "none", content: "none" });
});

test("headings use Merriweather and body text Geist", async ({ page }) => {
  // The landing uses the ink screens' own type (D18); the signed-out workspace keeps the Thyme theme.
  await page.goto("/app");

  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
  }));
  expect(fonts.heading).toMatch(/merriweather/i);
  expect(fonts.body).toMatch(/geist/i);
});

test("keyboard focus shows a 2px outline with a 3px offset", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { offset: style.outlineOffset, style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(outline).toEqual({ offset: "3px", style: "solid", width: "2px" });
});

test("reduced motion removes transitions and animation", async ({ baseURL, context, db, page }) => {
  await signedInHost(db, context, baseURL!);
  const duration = () =>
    page.getByRole("button", { name: "Open menu" }).evaluate((button) => getComputedStyle(button).transitionDuration);

  await page.goto("/app");
  expect(parseFloat(await duration())).toBeGreaterThan(0.1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  expect(parseFloat(await duration())).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Open menu" }).click();
  const menuAnimation = await page
    .getByRole("menu")
    .evaluate((menu) => parseFloat(getComputedStyle(menu).animationDuration));
  expect(menuAnimation).toBeLessThan(0.001);
});
