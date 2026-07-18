import { expect, test, type Page } from "@playwright/test";

const webBase = process.env.LEADVIRT_WEB_BASE ?? "http://localhost:3001";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: "leadvirt-locale", value: "ru", url: webBase, sameSite: "Lax" }]);
});

function accountSettings(businessName = "API Studio", businessProfileVersion = 3) {
  return {
    data: {
      tenant: {
        id: "tenant-demo",
        name: businessName,
        slug: "api-studio",
        status: "TRIALING",
        businessType: "clinic",
        timezone: "Europe/Paris",
      },
      owner: {
        id: "user-owner",
        email: "owner@api-studio.test",
        name: "API Owner",
        avatarUrl: null,
      },
      businessName,
      timezone: "Europe/Paris",
      description: "API-backed clinic workspace",
      phone: "+33 1 84 80 20 26",
      website: "https://api-studio.example",
      businessProfileVersion,
      businessProfileEtag: `"business-profile-settings-${businessProfileVersion}"`,
      businessProfileUpdatedAt: "2026-07-16T12:00:00.000Z",
    },
  };
}

function authMe(passwordChangeRequired = false, role = "OWNER") {
  return {
    data: {
      id: "user-owner",
      email: "owner@api-studio.test",
      name: "API Owner",
      avatarUrl: null,
      role,
      tenantId: "tenant-demo",
      authMode: "credentials",
      passwordChangeRequired,
    },
  };
}

function currentTenant(role = "OWNER") {
  return {
    data: {
      id: "tenant-demo",
      name: "API Studio",
      slug: "api-studio",
      status: "TRIALING",
      businessType: "clinic",
      timezone: "Europe/Paris",
      role,
    },
  };
}

async function installSettingsProfileDependencies(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });
  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });
  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          hasPassword: true,
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          twoFactor: {
            enabled: false,
            setupPending: false,
            confirmedAt: null,
            recoveryCodesRemaining: 0,
          },
          sessions: [],
        },
      },
    });
  });
  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });
  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });
}

test("settings page renders account controls without exposing technical-only settings", async ({
  page,
}) => {
  let accountPatch: Record<string, unknown> = {};
  let accountPatchIfMatch = "";
  let patchedRole = "";
  let releaseRolePatch!: () => void;
  const rolePatchGate = new Promise<void>((resolve) => {
    releaseRolePatch = resolve;
  });
  let invitedEmail = "";
  let removedMemberId = "";
  let notificationPatch: Record<string, boolean> = {};
  let apiKeyListRequests = 0;
  let apiKeyCreateRequests = 0;
  let passwordPatch: { currentPassword?: string; newPassword?: string } = {};
  let revokedSessionId = "";
  let twoFactorSetupRequested = false;
  let twoFactorEnabled = false;
  let twoFactorEnabledCode = "";
  let twoFactorRecoveryPassword = "";
  let twoFactorDisablePassword = "";
  let recoveryCodesRemaining = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    if (route.request().method() === "PATCH") {
      accountPatch = route.request().postDataJSON() as Record<string, unknown>;
      accountPatchIfMatch = route.request().headers()["if-match"] ?? "";
      await route.fulfill({
        json: {
          ...accountSettings(),
          data: {
            ...accountSettings().data,
            ...accountPatch,
          },
        },
      });
      return;
    }

    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team/membership-api", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { role?: string };
      patchedRole = body.role ?? "";
      await rolePatchGate;
      await route.fulfill({
        json: {
          data: {
            id: "membership-api",
            role: patchedRole,
            user: { id: "user-api-manager", email: "api-manager@example.com", name: "API Manager" },
          },
        },
      });
      return;
    }

    if (route.request().method() === "DELETE") {
      removedMemberId = "membership-api";
      await route.fulfill({ json: { data: { id: "membership-api", removed: true } } });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        email?: string;
        name?: string;
        role?: string;
      };
      invitedEmail = body.email ?? "";
      await route.fulfill({
        json: {
          data: {
            id: "membership-invited",
            role: body.role ?? "AGENT",
            user: {
              id: "user-invited",
              email: body.email,
              name: body.name,
            },
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: [
          {
            id: "membership-owner",
            role: "OWNER",
            user: {
              id: "user-owner",
              email: "owner@api-studio.test",
              name: "API Owner",
            },
          },
          {
            id: "membership-api",
            role: "MANAGER",
            user: {
              id: "user-api-manager",
              email: "api-manager@example.com",
              name: "API Manager",
            },
          },
        ],
      },
    });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          twoFactor: {
            enabled: twoFactorEnabled,
            setupPending: false,
            confirmedAt: twoFactorEnabled ? "2026-06-27T08:10:00.000Z" : null,
            recoveryCodesRemaining,
          },
          sessions: [
            {
              id: "session-current",
              current: true,
              ipAddress: "127.0.0.1",
              userAgent: "Mozilla/5.0 Chrome/140 Windows",
              createdAt: "2026-06-27T08:00:00.000Z",
              lastUsedAt: "2026-06-27T08:05:00.000Z",
              expiresAt: "2026-07-27T08:00:00.000Z",
            },
            {
              id: "session-other",
              current: false,
              ipAddress: "10.0.0.2",
              userAgent: "Mozilla/5.0 Mobile Safari iPhone",
              createdAt: "2026-06-26T08:00:00.000Z",
              lastUsedAt: "2026-06-26T08:05:00.000Z",
              expiresAt: "2026-07-26T08:00:00.000Z",
            },
          ],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/setup", async (route) => {
    twoFactorSetupRequested = true;
    await route.fulfill({
      json: {
        data: {
          secret: "JBSWY3DPEHPK3PXP",
          otpauthUri:
            "otpauth://totp/LeadVirt.ai:owner%40api-studio.test?secret=JBSWY3DPEHPK3PXP&issuer=LeadVirt.ai",
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/enable", async (route) => {
    twoFactorEnabledCode = (route.request().postDataJSON() as { code?: string }).code ?? "";
    twoFactorEnabled = true;
    recoveryCodesRemaining = 2;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: true,
            setupPending: false,
            confirmedAt: "2026-06-27T08:10:00.000Z",
            recoveryCodesRemaining,
          },
          recoveryCodes: ["LV-AAAA1111-BBBB2222", "LV-CCCC3333-DDDD4444"],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/recovery-codes", async (route) => {
    twoFactorRecoveryPassword =
      (route.request().postDataJSON() as { currentPassword?: string }).currentPassword ?? "";
    recoveryCodesRemaining = 2;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: true,
            setupPending: false,
            confirmedAt: "2026-06-27T08:10:00.000Z",
            recoveryCodesRemaining,
          },
          recoveryCodes: ["LV-EEEE5555-FFFF6666", "LV-GGGG7777-HHHH8888"],
        },
      },
    });
  });

  await page.route("**/api/settings/security/2fa/disable", async (route) => {
    twoFactorDisablePassword =
      (route.request().postDataJSON() as { currentPassword?: string }).currentPassword ?? "";
    twoFactorEnabled = false;
    recoveryCodesRemaining = 0;
    await route.fulfill({
      json: {
        data: {
          twoFactor: {
            enabled: false,
            setupPending: false,
            confirmedAt: null,
            recoveryCodesRemaining: 0,
          },
        },
      },
    });
  });

  await page.route("**/api/settings/security/password", async (route) => {
    passwordPatch = route.request().postDataJSON() as {
      currentPassword?: string;
      newPassword?: string;
    };
    await route.fulfill({ json: { data: { updated: true, revokedSessions: 1 } } });
  });

  await page.route("**/api/settings/security/sessions/session-other", async (route) => {
    revokedSessionId = "session-other";
    await route.fulfill({ json: { data: { id: "session-other", revoked: true, current: false } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    if (route.request().method() === "PATCH") {
      notificationPatch = route.request().postDataJSON() as Record<string, boolean>;
      await route.fulfill({
        json: {
          data: {
            new_lead: true,
            no_reply: false,
            booking: true,
            daily: false,
            tg_summary: true,
            ...notificationPatch,
          },
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: false,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({
      json: {
        data: {
          billingMode: "manual",
          apiKeys: [],
        },
      },
    });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    if (route.request().method() === "POST") {
      apiKeyCreateRequests += 1;
      await route.fulfill({
        status: 501,
        json: {
          error: {
            code: "API_KEYS_NOT_AVAILABLE",
            message: "Tenant API keys are not available.",
            retryable: false,
          },
        },
      });
      return;
    }

    apiKeyListRequests += 1;
    await route.fulfill({
      json: {
        data: [
          {
            id: "api-key-1",
            name: "Production API",
            keyPrefix: "lv_live_",
            createdAt: "2026-06-22T10:00:00.000Z",
            status: "INERT",
            cleanupOnly: true,
          },
        ],
      },
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  const phoneInput = page.getByTestId("settings-profile-phone");
  const websiteInput = page.getByTestId("settings-profile-website");
  await expect(page.getByTestId("settings-business-profile-summary")).toBeVisible();
  await expect(page.getByTestId("settings-business-profile-link")).toHaveAttribute(
    "href",
    "/app/knowledge?view=business",
  );
  await expect(page.getByTestId("settings-business-profile-name")).toHaveText("API Studio");
  await expect(page.getByTestId("settings-business-profile-type")).toHaveText("Клиника");
  await expect(page.getByTestId("settings-business-profile-timezone")).toHaveText("Europe/Paris");
  await expect(page.getByTestId("settings-business-profile-description")).toHaveText(
    "API-backed clinic workspace",
  );
  await expect(page.getByTestId("settings-profile-description")).toHaveCount(0);
  await expect(page.getByPlaceholder("Введите название")).toHaveCount(0);
  await expect(phoneInput).toHaveValue("+33 1 84 80 20 26");
  await expect(websiteInput).toHaveValue("https://api-studio.example");
  await expect(page.getByTestId("settings-account-email")).toHaveValue("owner@api-studio.test");

  await phoneInput.fill("+1 202 555 0142");
  await websiteInput.fill("https://updated.api-studio.example");
  await page.getByTestId("settings-contact-save").click();
  await expect
    .poll(() => accountPatch)
    .toEqual({
      phone: "+1 202 555 0142",
      website: "https://updated.api-studio.example",
    });
  expect(accountPatchIfMatch).toBe("");
  expect(accountPatch).not.toHaveProperty("businessName");
  expect(accountPatch).not.toHaveProperty("businessType");
  expect(accountPatch).not.toHaveProperty("timezone");
  expect(accountPatch).not.toHaveProperty("description");
  expect(accountPatch).not.toHaveProperty("logoDataUrl");
  await expect(page.getByTestId("settings-business-profile-name")).toHaveText("API Studio");

  await page.getByRole("button", { name: /Команда и роли/ }).click();
  await expect(page.getByTestId("settings-team-member-membership-owner")).toContainText(
    "API Owner",
  );
  await expect(
    page.getByTestId("settings-team-member-membership-owner").getByRole("button"),
  ).toHaveCount(0);
  await expect(page.getByText("API Manager")).toBeVisible();
  await expect(page.getByText("api-manager@example.com")).toBeVisible();
  const managerMenu = page.getByLabel("Управление API Manager");
  const inviteMember = page.getByLabel("Пригласить участника");
  await managerMenu.click();
  await page.getByRole("menuitem").nth(2).click();
  await expect.poll(() => patchedRole).toBe("AGENT");
  await expect(managerMenu).toBeDisabled();
  await expect(inviteMember).toBeDisabled();
  releaseRolePatch();
  await expect(managerMenu).toBeEnabled();
  await expect(inviteMember).toBeEnabled();

  await inviteMember.click();
  await page.getByPlaceholder("name@company.ru").fill("new-agent@example.com");
  await page.getByPlaceholder("Имя участника").fill("New Agent");
  await page.getByRole("button", { name: "Добавить" }).click();
  await expect.poll(() => invitedEmail).toBe("new-agent@example.com");
  await expect(page.getByText("New Agent")).toBeVisible();

  await page.getByLabel("Управление API Manager").click();
  await page.getByRole("menuitem").last().click();
  await page.getByRole("button", { name: "Удалить" }).click();
  await expect.poll(() => removedMemberId).toBe("membership-api");

  await page
    .getByRole("main")
    .getByRole("button", { name: /Уведомления/ })
    .click();
  await page.getByRole("switch").first().click();
  await expect.poll(() => notificationPatch.new_lead).toBe(false);

  await page
    .getByRole("main")
    .getByRole("button", { name: /Безопасность/ })
    .click();
  await expect(page.getByText("Текущая роль")).toBeVisible();
  await expect(page.getByText("Пароль", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/IP 10\.0\.0\.2/)).toHaveCount(0);
  await page.getByLabel("Текущий пароль").fill("demo-demo");
  await page.getByLabel("Новый пароль").fill("new-demo-pass");
  await page.getByLabel("Повторите пароль").fill("new-demo-pass");
  await page.getByRole("button", { name: /Обновить пароль/ }).click();
  await expect.poll(() => passwordPatch.newPassword).toBe("new-demo-pass");
  await page.getByRole("button", { name: "Закрыть" }).click();
  await expect.poll(() => revokedSessionId).toBe("session-other");

  const twoFactorCard = page.getByTestId("settings-two-factor-card");
  await expect(twoFactorCard).toContainText("Выключено");
  await twoFactorCard.getByRole("button", { name: /Настроить 2FA/ }).click();
  await expect.poll(() => twoFactorSetupRequested).toBe(true);
  await expect(twoFactorCard.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  await twoFactorCard.getByLabel("2FA код подтверждения").fill("123456");
  await twoFactorCard.getByRole("button", { name: /Подтвердить и включить/ }).click();
  await expect.poll(() => twoFactorEnabledCode).toBe("123456");
  await expect(twoFactorCard).toContainText("Включено");
  await expect(twoFactorCard.getByText("LV-AAAA1111-BBBB2222")).toBeVisible();
  await twoFactorCard.getByLabel("Пароль для 2FA действий").fill("demo-demo");
  await twoFactorCard.getByRole("button", { name: /Новые recovery codes/ }).click();
  await expect.poll(() => twoFactorRecoveryPassword).toBe("demo-demo");
  await expect(twoFactorCard.getByText("LV-EEEE5555-FFFF6666")).toBeVisible();
  await twoFactorCard.getByLabel("Пароль для 2FA действий").fill("demo-demo");
  await twoFactorCard.getByRole("button", { name: "Отключить 2FA" }).click();
  await expect.poll(() => twoFactorDisablePassword).toBe("demo-demo");
  await expect(twoFactorCard).toContainText("Выключено");

  await expect(page.getByRole("main").getByRole("button", { name: /API ключи/ })).toHaveCount(0);
  expect(apiKeyListRequests).toBe(0);
  expect(apiKeyCreateRequests).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileViewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileViewport.scrollWidth).toBeLessThanOrEqual(mobileViewport.innerWidth);
  await page.screenshot({
    path: "artifacts/playwright/settings-security-mobile.png",
    fullPage: true,
  });
});

test("settings logo update preserves contact drafts and cannot overwrite business information", async ({
  page,
}) => {
  await installSettingsProfileDependencies(page);
  const patchBodies: Record<string, unknown>[] = [];
  const patchIfMatches: string[] = [];

  await page.route("**/api/settings/account", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({ json: accountSettings() });
      return;
    }

    const patchBody = route.request().postDataJSON() as Record<string, unknown>;
    patchBodies.push(patchBody);
    patchIfMatches.push(route.request().headers()["if-match"] ?? "");
    const response = accountSettings("Server canonical profile", 99);
    await route.fulfill({
      json: {
        ...response,
        data: {
          ...response.data,
          ...patchBody,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });
  const profileEditor = page.getByTestId("settings-profile-editor");
  const phoneInput = page.getByTestId("settings-profile-phone");
  const websiteInput = page.getByTestId("settings-profile-website");
  await expect(profileEditor).toBeVisible();
  await phoneInput.fill("+1 202 555 0199");
  await websiteInput.fill("https://draft.api-studio.example");
  await page.getByTestId("settings-logo-input").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(Object.keys(patchBodies[0])).toEqual(["logoDataUrl"]);
  expect(patchBodies[0]).not.toHaveProperty("businessName");
  expect(patchBodies[0]).not.toHaveProperty("businessType");
  expect(patchBodies[0]).not.toHaveProperty("timezone");
  expect(patchBodies[0]).not.toHaveProperty("description");
  expect(patchBodies[0]).not.toHaveProperty("phone");
  expect(patchBodies[0]).not.toHaveProperty("website");
  expect(patchIfMatches[0]).toBe("");
  await expect(page.getByTestId("settings-logo-preview")).toBeVisible();
  await expect(page.getByTestId("settings-business-profile-name")).toHaveText(
    "Server canonical profile",
  );
  await expect(phoneInput).toHaveValue("+1 202 555 0199");
  await expect(websiteInput).toHaveValue("https://draft.api-studio.example");

  const save = page.getByTestId("settings-contact-save");
  await save.click();
  await expect.poll(() => patchBodies.length).toBe(2);
  expect(patchBodies[1]).toEqual({
    phone: "+1 202 555 0199",
    website: "https://draft.api-studio.example",
  });
  expect(patchIfMatches[1]).toBe("");
  expect(patchBodies[1]).not.toHaveProperty("businessName");
  expect(patchBodies[1]).not.toHaveProperty("businessType");
  expect(patchBodies[1]).not.toHaveProperty("timezone");
  expect(patchBodies[1]).not.toHaveProperty("description");
  await expect(save).toBeDisabled();
});

test("settings contact save accepts a newer canonical profile without a stale write", async ({
  page,
}) => {
  await installSettingsProfileDependencies(page);
  let patchBody: Record<string, unknown> = {};
  let patchIfMatch = "not-sent";

  await page.route("**/api/settings/account", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.fulfill({ json: accountSettings("API Studio", 3) });
      return;
    }

    patchBody = route.request().postDataJSON() as Record<string, unknown>;
    patchIfMatch = route.request().headers()["if-match"] ?? "";
    const response = accountSettings("Server profile", 4);
    await route.fulfill({
      json: {
        ...response,
        data: {
          ...response.data,
          ...patchBody,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });
  await page.getByTestId("settings-profile-phone").fill("+49 30 123456");
  await page.getByTestId("settings-contact-save").click();

  await expect
    .poll(() => patchBody)
    .toEqual({
      phone: "+49 30 123456",
      website: "https://api-studio.example",
    });
  expect(patchIfMatch).toBe("");
  expect(patchBody).not.toHaveProperty("businessName");
  expect(patchBody).not.toHaveProperty("businessType");
  expect(patchBody).not.toHaveProperty("timezone");
  expect(patchBody).not.toHaveProperty("description");
  await expect(page.getByTestId("settings-business-profile-name")).toHaveText("Server profile");
  await expect(page.getByTestId("settings-business-profile-type")).toHaveText("Клиника");
  await expect(page.getByTestId("settings-business-profile-timezone")).toHaveText("Europe/Paris");
});

test("owner API-key deep link falls back to profile without loading legacy keys", async ({
  page,
}) => {
  let apiKeyListRequests = 0;
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    apiKeyListRequests += 1;
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings?tab=api`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("settings-profile-editor")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /API ключи/ })).toHaveCount(0);
  expect(apiKeyListRequests).toBe(0);
});

test("email-code account gets passwordless security guidance without infrastructure details", async ({
  page,
}) => {
  let apiKeyListRequests = 0;

  await page.route("**/api/auth/me", async (route) => {
    const response = authMe(false);
    await route.fulfill({
      json: { data: { ...response.data, authMode: "email" } },
    });
  });
  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });
  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });
  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: { new_lead: true, no_reply: true, booking: true, daily: false, tg_summary: true },
      },
    });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "email",
          hasPassword: false,
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          twoFactor: {
            enabled: false,
            setupPending: false,
            confirmedAt: null,
            recoveryCodesRemaining: 0,
          },
          sessions: [
            {
              id: "email-session",
              current: true,
              ipAddress: "203.0.113.10",
              userAgent: "Mozilla/5.0 Chrome/140 Windows",
              createdAt: "2026-07-17T08:00:00.000Z",
              lastUsedAt: "2026-07-17T08:05:00.000Z",
              expiresAt: "2026-08-17T08:00:00.000Z",
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/settings/api-keys", async (route) => {
    apiKeyListRequests += 1;
    await route.fulfill({ json: { data: [] } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${webBase}/app/settings?tab=security`, { waitUntil: "networkidle" });

  await expect(page.getByText("Код из email", { exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-passwordless-note")).toContainText(
    "одноразовый код на вашу почту",
  );
  await expect(page.getByLabel("Текущий пароль")).toHaveCount(0);
  await expect(page.getByText("Tenant isolation")).toHaveCount(0);
  await expect(page.getByText(/203\.0\.113\.10/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Настроить 2FA/ })).toHaveCount(0);
  await expect(page.getByTestId("settings-two-factor-card")).toContainText(
    "только для входа по паролю",
  );
  await expect(page.getByRole("main").getByRole("button", { name: /API ключи/ })).toHaveCount(0);
  expect(apiKeyListRequests).toBe(0);

  const settingsTabs = page.locator('nav[aria-label="Настройки"] button');
  await expect(settingsTabs.first()).toBeVisible();
  const smallestTarget = await settingsTabs.evaluateAll((buttons) =>
    Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
  );
  expect(smallestTarget).toBeGreaterThanOrEqual(44);
});

test("email-code session keeps password and authenticator controls for a password account", async ({
  page,
}) => {
  await installSettingsProfileDependencies(page);
  await page.unroute("**/api/auth/me");
  await page.unroute("**/api/settings/security");

  await page.route("**/api/auth/me", async (route) => {
    const response = authMe(false);
    await route.fulfill({ json: { data: { ...response.data, authMode: "email" } } });
  });
  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });
  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "email",
          hasPassword: true,
          productionAuthReadyFor: ["Local credentials", "HTTP-only sessions"],
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          twoFactor: {
            enabled: false,
            setupPending: false,
            confirmedAt: null,
            recoveryCodesRemaining: 0,
          },
          sessions: [],
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings?tab=security`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("settings-passwordless-note")).toHaveCount(0);
  await expect(page.getByTestId("settings-password-controls")).toBeVisible();
  await expect(
    page.getByTestId("settings-password-controls").locator('input[type="password"]'),
  ).toHaveCount(3);
  await expect(page.getByTestId("settings-two-factor-setup")).toBeVisible();
});

test("non-admin member cannot see or deep-link into API-key cleanup", async ({ page }) => {
  let apiKeyListRequests = 0;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false, "MANAGER") });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant("MANAGER") });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "MANAGER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/api-keys", async (route) => {
    apiKeyListRequests += 1;
    await route.fulfill({
      json: {
        data: [
          {
            id: "must-not-render",
            name: "Hidden legacy key",
            keyPrefix: "lv_hidden_",
            createdAt: "2026-06-22T10:00:00.000Z",
            status: "INERT",
            cleanupOnly: true,
          },
        ],
      },
    });
  });

  await page.goto(`${webBase}/app/settings?tab=api`, { waitUntil: "networkidle" });

  await expect(page.getByTestId("settings-profile-editor")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /API ключи/ })).toHaveCount(0);
  await expect(page.getByText("Hidden legacy key")).toHaveCount(0);
  await expect(page.getByText(/lv_hidden_/)).toHaveCount(0);
  expect(apiKeyListRequests).toBe(0);
});

test("settings account initial failure stays explicit and recovers on retry", async ({ page }) => {
  let accountRequests = 0;
  let accountAvailable = false;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(false) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    accountRequests += 1;
    if (!accountAvailable) {
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "SETTINGS_UNAVAILABLE",
            message: "Account settings are temporarily unavailable.",
            retryable: true,
          },
        },
      });
      return;
    }
    await route.fulfill({ json: accountSettings("Recovered API Studio") });
  });

  await page.route("**/api/settings/team**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired: false,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.goto(`${webBase}/app/settings`, { waitUntil: "networkidle" });

  const loadError = page.getByTestId("settings-account-load-error");
  await expect(loadError).toBeVisible();
  await expect(page.getByTestId("settings-profile-editor")).toHaveCount(0);
  await expect(page.getByTestId("settings-business-profile-summary")).toHaveCount(0);
  await expect(page.getByTestId("settings-profile-phone")).toHaveCount(0);
  await expect(page.getByTestId("settings-profile-website")).toHaveCount(0);

  accountAvailable = true;
  await loadError.getByRole("button").click();

  await expect.poll(() => accountRequests).toBeGreaterThan(1);
  await expect(loadError).toBeHidden();
  await expect(page.getByTestId("settings-profile-editor")).toBeVisible();
  await expect(page.getByTestId("settings-business-profile-name")).toHaveText(
    "Recovered API Studio",
  );
  await expect(page.getByTestId("settings-business-profile-description")).toHaveText(
    "API-backed clinic workspace",
  );
  await expect(page.getByTestId("settings-profile-phone")).toHaveValue("+33 1 84 80 20 26");
  await expect(page.getByTestId("settings-profile-website")).toHaveValue(
    "https://api-studio.example",
  );
});

test("temporary password users are routed to Security and clear the warning after changing password", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let passwordPatch: { currentPassword?: string; newPassword?: string } = {};
  let passwordChangeRequired = true;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: authMe(passwordChangeRequired) });
  });

  await page.route("**/api/current-tenant", async (route) => {
    await route.fulfill({ json: currentTenant() });
  });

  await page.route("**/api/settings/account", async (route) => {
    await route.fulfill({ json: accountSettings() });
  });

  await page.route("**/api/settings/team**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.endsWith("/api/settings/team")) {
      await route.fallback();
      return;
    }

    await route.fulfill({ json: { data: [] } });
  });

  await page.route("**/api/settings/billing", async (route) => {
    await route.fulfill({ json: { data: { billingMode: "manual", apiKeys: [] } } });
  });

  await page.route("**/api/settings/notifications", async (route) => {
    await route.fulfill({
      json: {
        data: {
          new_lead: true,
          no_reply: true,
          booking: true,
          daily: false,
          tg_summary: true,
        },
      },
    });
  });

  await page.route("**/api/settings/security", async (route) => {
    await route.fulfill({
      json: {
        data: {
          authMode: "credentials",
          tenantScoped: true,
          currentRole: "OWNER",
          passwordChangeRequired,
          sessions: [],
        },
      },
    });
  });

  await page.route("**/api/settings/security/password", async (route) => {
    passwordPatch = route.request().postDataJSON() as {
      currentPassword?: string;
      newPassword?: string;
    };
    passwordChangeRequired = false;
    await route.fulfill({ json: { data: { updated: true, revokedSessions: 0 } } });
  });

  await page.goto(`${webBase}/app`, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/app\/settings\?tab=security/, { timeout: 15_000 });
  await expect(page.getByText("Нужно сменить временный пароль")).toBeVisible();
  await page.screenshot({
    path: "artifacts/playwright/settings-password-change-required.png",
    fullPage: true,
  });

  await page.getByLabel("Текущий пароль").fill("lv-temp-pass-once");
  await page.getByLabel("Новый пароль").fill("new-permanent-pass");
  await page.getByLabel("Повторите пароль").fill("new-permanent-pass");
  await page.getByRole("button", { name: /Обновить пароль/ }).click();

  await expect.poll(() => passwordPatch.currentPassword).toBe("lv-temp-pass-once");
  await expect.poll(() => passwordPatch.newPassword).toBe("new-permanent-pass");
  await expect(page.getByText("Нужно сменить временный пароль")).toBeHidden();
});
