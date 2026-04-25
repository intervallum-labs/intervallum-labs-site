/**
 * Pull "New" HTML files from SharePoint (Processed folder), write to repo articles/<slug>.html,
 * then mark SharePoint PublishStatus = Published.
 *
 * Slug rule: filename (minus .html) is the slug.
 */

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const {
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  SITE_ID,
  DRIVE_ID,
  PROCESSED_PATH = "Processed",
  STATUS_FIELD = "PublishStatus",
  STATUS_NEW = "New",
  STATUS_PUBLISHED = "Published",
} = process.env;

function required(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

required("TENANT_ID", TENANT_ID);
required("CLIENT_ID", CLIENT_ID);
required("CLIENT_SECRET", CLIENT_SECRET);
required("SITE_ID", SITE_ID);
required("DRIVE_ID", DRIVE_ID);

const GRAPH = "https://graph.microsoft.com/v1.0";

async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.access_token;
}

async function graphFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  // Follow 302 manually if present (Graph /content can return redirect)
  if (res.status === 302 || res.status === 301) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("Redirect received but no Location header");
    const fileRes = await fetch(loc);
    if (!fileRes.ok) {
      const t = await fileRes.text();
      throw new Error(`Download redirect fetch failed (${fileRes.status}): ${t}`);
    }
    return fileRes;
  }

  return res;
}

function slugFromFilename(filename) {
  // Use filename (minus .html) as slug
  // Keep as-is except remove extension and trim whitespace.
  // (If you later want URL-friendly slugs, replace spaces with hyphens here.)
  return filename.replace(/\.html$/i, "").trim();
}

async function listProcessedChildren(token) {
  // List items in /Processed folder. We expand listItem and fields so we can read PublishStatus.
  // This pattern is known to return listItem + fields under listItem when using children?$expand=listItem. [4](https://stackoverflow.com/questions/78845084/expand-driveitems-listitem-property-while-selecting-fields-from-listitem)
  const encodedPath = encodeURIComponent(PROCESSED_PATH).replace(/%2F/g, "/");
  const url =
    `${GRAPH}/drives/${DRIVE_ID}/root:/${encodedPath}:/children` +
    `?$expand=listItem($expand=fields)&$top=200`;

  const res = await graphFetch(token, url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List folder children failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function downloadDriveItemHtml(token, itemId) {
  // Download content of drive item [1](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
  const url = `${GRAPH}/drives/${DRIVE_ID}/items/${itemId}/content`;
  const res = await graphFetch(token, url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download content failed (${res.status}): ${text}`);
  }
  return res.text();
}

async function updatePublishStatus(token, listItem, newStatus) {
  // Official way to update fields is PATCH .../fields on listItem [2](https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0)[3](https://learn.microsoft.com/en-us/graph/api/listitem-list?view=graph-rest-1.0)
  // We need list-id and listItem-id. We can derive listId from listItem.parentReference if present.
  // If not present, we fall back to querying the drive's underlying list.
  const listItemId = listItem?.id;
  const siteId = listItem?.parentReference?.siteId || SITE_ID;
  const listId = listItem?.parentReference?.listId; // sometimes present, sometimes not

  let resolvedListId = listId;

  if (!resolvedListId) {
    // Try to resolve listId from drive -> list relationship by asking the drive for its "list"
    // (If your tenant doesn't return it, set LIST_ID as a secret and add support here.)
    const driveUrl = `${GRAPH}/sites/${SITE_ID}/drives/${DRIVE_ID}?$select=id,name&$expand=list`;
    const driveRes = await graphFetch(token, driveUrl);
    if (driveRes.ok) {
      const driveJson = await driveRes.json();
      resolvedListId = driveJson?.list?.id;
    }
  }

  if (!resolvedListId) {
    throw new Error(
      "Could not resolve SharePoint listId for the document library. " +
      "Workaround: add a GitHub secret LIST_ID and update the script to use it."
    );
  }

  const url = `${GRAPH}/sites/${siteId}/lists/${resolvedListId}/items/${listItemId}/fields`;

  const body = {};
  body[STATUS_FIELD] = newStatus;

  const res = await graphFetch(token, url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update fields failed (${res.status}): ${text}`);
  }
}

async function main() {
  const token = await getGraphToken();

  // Ensure output folder exists
  fs.mkdirSync("articles", { recursive: true });

  const data = await listProcessedChildren(token);
  const items = data?.value || [];

  const htmlItems = items.filter((it) => (it?.name || "").toLowerCase().endsWith(".html"));

  // Filter to New based on listItem.fields.PublishStatus
  const toPublish = htmlItems.filter((it) => {
    const fields = it?.listItem?.fields || {};
    return (fields[STATUS_FIELD] || "") === STATUS_NEW;
  });

  console.log(`Found ${toPublish.length} HTML item(s) with ${STATUS_FIELD}=${STATUS_NEW} in ${PROCESSED_PATH}.`);

  for (const it of toPublish) {
    const filename = it.name;
    const slug = slugFromFilename(filename);
    const articlePath = path.join("articles", `${slug}.html`);

    console.log(`Publishing: ${filename} -> ${articlePath}`);

    const html = await downloadDriveItemHtml(token, it.id);
    fs.writeFileSync(articlePath, html, "utf8");

    // Mark as Published in SharePoint
    await updatePublishStatus(token, it.listItem, STATUS_PUBLISHED);

    console.log(`Marked SharePoint status: ${STATUS_FIELD}=${STATUS_PUBLISHED} for ${filename}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
``