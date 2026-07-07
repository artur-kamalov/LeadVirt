const graphVersion = (process.env.META_GRAPH_VERSION || "v25.0").trim();
const userToken = (process.env.META_USER_ACCESS_TOKEN || "").trim();
const targetPageId = (process.env.META_PAGE_ID || "").trim();
const targetIgAccountId = (process.env.META_IG_ACCOUNT_ID || "").trim();
const requireConversation = process.env.META_REQUIRE_INSTAGRAM_CONVERSATION === "1";
const printMessageText = process.env.META_PRINT_INSTAGRAM_MESSAGE_TEXT === "1";

const requiredPermissions = ["pages_show_list", "pages_manage_metadata", "instagram_basic", "instagram_manage_messages"];

class GraphError extends Error {
  constructor(message, error) {
    super(message);
    this.error = error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function compactRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function publicTokenHint(token) {
  if (!token) return "missing";
  return `${token.slice(0, 6)}...${token.slice(-4)} (${token.length} chars)`;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

async function graph(path, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = compactRecord(payload.error);
    throw new GraphError(
      `${error.message || response.statusText} (code=${error.code || response.status}, type=${error.type || "unknown"}, fbtrace_id=${error.fbtrace_id || "n/a"})`,
      error
    );
  }
  return payload;
}

async function main() {
  assert(userToken, "Set META_USER_ACCESS_TOKEN in your shell before running this smoke. Do not commit or paste it into chat.");

  console.log("Meta Instagram preflight");
  console.log(`Graph version: ${graphVersion}`);
  console.log(`User token: ${publicTokenHint(userToken)}`);
  console.log(`Require Instagram conversation: ${requireConversation ? "yes" : "no"}`);

  const me = await graph("/me", userToken, { fields: "id,name" });
  console.log(`User: ${me.name || "unknown"} (${me.id || "no-id"})`);

  const permissionsPayload = await graph("/me/permissions", userToken);
  const permissions = Array.isArray(permissionsPayload.data) ? permissionsPayload.data : [];
  const granted = new Set(
    permissions
      .filter((item) => item && item.status === "granted" && typeof item.permission === "string")
      .map((item) => item.permission)
  );

  console.log("Permissions:");
  for (const permission of requiredPermissions) {
    console.log(`- ${permission}: ${granted.has(permission) ? "granted" : "missing"}`);
  }

  const accounts = await graph("/me/accounts", userToken, {
    fields: "id,name,tasks,access_token,instagram_business_account{id,username,name}"
  });
  const pages = Array.isArray(accounts.data) ? accounts.data : [];
  const filteredPages = targetPageId ? pages.filter((page) => page.id === targetPageId) : pages;
  console.log(`Pages visible to token: ${pages.length}${targetPageId ? `, filtered to ${filteredPages.length}` : ""}`);
  if (pages.length === 0) {
    console.log("No Pages were returned by /me/accounts. Check pages_show_list, Page full control, app role, and Business asset assignment.");
  }

  let workingInstagramPage = null;
  const pageFailures = [];

  for (const page of filteredPages) {
    const pageId = String(page.id || "");
    const pageName = String(page.name || "Unnamed Page");
    const tasks = Array.isArray(page.tasks) ? page.tasks.join(",") : "";
    const embeddedIg = compactRecord(page.instagram_business_account);
    const pageDetails = await graph(`/${pageId}`, userToken, {
      fields: "access_token,instagram_business_account{id,username,name}"
    }).catch((error) => {
      pageFailures.push(`${pageName} (${pageId}): cannot get page token: ${error.message}`);
      return null;
    });

    const ig = compactRecord(pageDetails?.instagram_business_account || embeddedIg);
    if (targetIgAccountId && ig.id !== targetIgAccountId) continue;

    console.log(`Page: ${pageName} (${pageId})${tasks ? ` tasks=${tasks}` : ""}`);
    if (!ig.id) {
      console.log("- Instagram account: missing/not connected");
      continue;
    }
    console.log(`- Instagram account: ${ig.username ? `@${ig.username}` : ig.name || "unnamed"} (${ig.id})`);

    const pageToken = String(pageDetails?.access_token || page.access_token || "");
    if (!pageToken) {
      pageFailures.push(`${pageName} (${pageId}): no Page Access Token returned`);
      continue;
    }

    try {
      const conversations = await graph(`/${pageId}/conversations`, pageToken, {
        platform: "instagram",
        limit: "1",
        fields: "id,updated_time"
      });
      const conversationRows = arrayValue(conversations.data);
      const count = conversationRows.length;
      console.log(`- Instagram conversations query: OK (${count} returned with limit=1)`);
      if (count > 0) {
        const conversation = compactRecord(conversationRows[0]);
        const conversationId = String(conversation.id || "");
        console.log(`- Latest Instagram conversation: ${conversationId || "unknown"}${conversation.updated_time ? ` updated=${conversation.updated_time}` : ""}`);
        if (conversationId) {
          const details = await graph(`/${conversationId}`, pageToken, {
            fields: "id,updated_time,participants,messages.limit(3){id,created_time,from,to,message}"
          }).catch((error) => {
            pageFailures.push(`${pageName} (${pageId}): conversation detail query failed: ${error.message}`);
            return null;
          });
          const messages = arrayValue(compactRecord(details?.messages).data);
          if (messages.length > 0) {
            console.log(`- Latest Instagram messages visible: ${messages.length}`);
            for (const message of messages) {
              const row = compactRecord(message);
              const messageId = String(row.id || "unknown");
              const createdAt = String(row.created_time || "unknown-time");
              const text = typeof row.message === "string" ? row.message : "";
              console.log(`  - ${messageId} at ${createdAt}${printMessageText && text ? ` text="${text}"` : ""}`);
            }
          }
        }
      }
      if (requireConversation && count === 0) {
        pageFailures.push(`${pageName} (${pageId}): no Instagram DM conversations returned; send a DM to @${ig.username || ig.id} from a different Instagram account and retry.`);
        continue;
      }
      workingInstagramPage = { pageId, pageName, igId: String(ig.id), igUsername: String(ig.username || ""), conversationCount: count };
      break;
    } catch (error) {
      pageFailures.push(`${pageName} (${pageId}): conversations query failed: ${error.message}`);
    }
  }

  if (workingInstagramPage) {
    console.log(
      `PASS: Instagram Messaging API preflight works for page ${workingInstagramPage.pageName} (${workingInstagramPage.pageId}) and IG ${workingInstagramPage.igUsername ? `@${workingInstagramPage.igUsername}` : workingInstagramPage.igId}; conversations=${workingInstagramPage.conversationCount}.`
    );
    return;
  }

  for (const failure of pageFailures) {
    console.log(`FAIL DETAIL: ${failure}`);
  }
  throw new Error("No connected Instagram Professional account passed the conversations preflight.");
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
