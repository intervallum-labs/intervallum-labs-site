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
  return String(filename)
    .replace(/\.html$/i, "")           // remove .html extension
    .normalize("NFKD")                 // unicode normalize (splits accents)
    .replace(/[\u0300-\u036f]/g, "")   // remove accents/diacritics
    .trim()                            // trim whitespace
    .toLowerCase()                     // lowercase
    .replace(/[^a-z0-9]+/g, "-")       // non-alphanumerics -> dash
    .replace(/^-+|-+$/g, "")           // trim leading/trailing dashes
    .replace(/-{2,}/g, "-");           // collapse multiple dashes
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

function extractTitle(html, filename) {
  // Try <title> tag first
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1]
      .replace(/\s*\|\s*Exported$/i, "")
      .replace(/\.md$/i, "")
      .trim();
  }
  // Fall back to first <h1>
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();
  // Last resort: humanise the filename
  return filename.replace(/\.html$/i, "").replace(/[-_]+/g, " ").trim();
}

function extractExcerpt(html) {
  // Strip <style> and <script> blocks before scanning for <p> tags
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, "")
                   .replace(/<script[\s\S]*?<\/script>/gi, "");
  const matches = body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
  for (const m of matches) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 20) return text.length > 160 ? text.slice(0, 157) + "…" : text;
  }
  return "";
}

function rebuildManifest() {
  const manifestPath = path.join("articles", "index.json");

  // Load existing manifest to preserve publishedAt dates
  const existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const entry of (parsed.articles || [])) {
      existing[entry.filename] = entry;
    }
  } catch (_) {}

  const files = fs.readdirSync("articles").filter(f => f.toLowerCase().endsWith(".html"));

  const articles = files.map(filename => {
    const filePath = path.join("articles", filename);
    const html = fs.readFileSync(filePath, "utf8");
    const slug = slugFromFilename(filename);
    const title = extractTitle(html, filename);
    const excerpt = extractExcerpt(html);
    const publishedAt = existing[filename]?.publishedAt
      || fs.statSync(filePath).mtime.toISOString();
    return { slug, title, excerpt, filename, publishedAt };
  });

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  fs.writeFileSync(manifestPath, JSON.stringify({ articles }, null, 2), "utf8");
  console.log(`Manifest rebuilt with ${articles.length} article(s).`);
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

  rebuildManifest();
  console.log("Done.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
``