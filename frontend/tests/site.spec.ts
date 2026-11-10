import { expect, test } from "@playwright/test";

// The site must remain usable without third-party font hosts.
test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
});

test("homepage renders institutional branding and navigation", async ({page}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Vivaion Empresas/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("conhecimento que desenvolve pessoas");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("link", { name: "Explorar catálogo" })).toBeVisible();
});

test("catalog remains explicit demonstration until official sync is available", async ({page}) => {
  await page.goto("/catalogo/");
  await expect(page.locator("#catalog-notice")).toContainText("Visualização demonstrativa");
  await expect(page.locator(".course-card")).toHaveCount(4);
  await page.locator("#search").fill("neurociência");
  await expect(page.locator(".course-card")).toHaveCount(1);
});

test("registration and contact pages provide accessible field labels", async ({page}) => {
  await page.goto("/cadastro/");
  await expect(page.getByRole("textbox", { name: "Razão social" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "CNPJ" })).toBeVisible();
  await expect(page.locator("#register-form").getByRole("link", { name: "aviso de privacidade", exact: true })).toBeVisible();
  await page.goto("/contato/");
  await expect(page.getByRole("textbox", { name: "Qual é a necessidade?" })).toBeVisible();
});

test("responsive pages avoid horizontal overflow and mobile menu navigates", async ({page, isMobile}) => {
  for (const path of ["/", "/catalogo/", "/cadastro/", "/painel/"]) {
    await page.goto(path);
    const width = page.viewportSize()?.width ?? 0;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, path + " has horizontal overflow").toBeLessThanOrEqual(width + 2);
  }
  if (isMobile) {
    await page.goto("/");
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
    await page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Para empresas" }).click();
    await expect(page).toHaveURL(/\/para-empresas\/$/);
  }
});

test("email confirmation, password recovery and reset URLs are safe and accessible", async ({page}) => {
  await page.goto("/recuperar-acesso/");
  await expect(page.getByRole("textbox", {name:"E-mail"})).toBeVisible();
  await page.goto("/reenviar-confirmacao/");
  await expect(page.getByRole("textbox", {name:"E-mail cadastrado"})).toBeVisible();
  await page.goto("/confirmar-email/?token=invalid");
  await expect(page.locator("#verify-status")).toContainText("Link inválido");
  await expect(page).toHaveURL(/\/confirmar-email\/$/);
  await page.goto("/redefinir-senha/?token=fake");
  await expect(page.locator("#reset-status")).toContainText("Link inválido");
  await expect(page).toHaveURL(/\/redefinir-senha\/$/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content","no-referrer");
});
