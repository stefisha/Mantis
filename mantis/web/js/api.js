export async function api(path, options = {}) {
  const response = await fetch("/api" + path, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The server returned an unexpected response. Please retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "Please check the submitted information.",
    );
  return body;
}
