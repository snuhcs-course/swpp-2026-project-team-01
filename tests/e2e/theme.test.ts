import { expect, signedInHost, test } from "./support/session";

// The rendered ink theme (DESIGN.md): flat paper with no texture layer, the
// display and body faces, focus outlines and reduced motion.

test("the paper is flat: the ink canvas and no texture layer", async ({ page }) => {
  await page.goto("/");

  const paper = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    layer: getComputedStyle(document.body, "::before").content,
  }));
  expect(paper).toEqual({ background: "rgb(246, 247, 249)", layer: "none" });
});

test("the signed-out workspace uses Instrument Serif headings and Geist body text", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Find Me a Time" })).toBeVisible();

  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.querySelector("main")!).fontFamily,
    heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
  }));
  expect(fonts.heading).toMatch(/instrument.serif/i);
  expect(fonts.body).toMatch(/geist/i);
});

test("Korean headings use Hahmlet", async ({ page }) => {
  await page.goto("/privacy?lang=ko");

  const heading = await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily);
  expect(heading).toMatch(/hahmlet/i);
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
