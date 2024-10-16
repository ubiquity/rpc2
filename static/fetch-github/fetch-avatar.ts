import { Octokit } from "@octokit/rest";
import { getGitHubAccessToken } from "../getters/get-github-access-token";
import { getImageFromCache, saveImageToCache } from "../getters/get-indexed-db";
import { renderErrorInModal } from "../rendering/display-popup-modal";
import { organizationImageCache } from "./fetch-issues-full";

// Map to track ongoing avatar fetches
const pendingFetches: Map<string, Promise<Blob | void>> = new Map();

// Fetches the avatar for a given organization from GitHub either from cache, indexedDB or GitHub API
export async function fetchAvatar(orgName: string): Promise<Blob | void> {
  // Check if the avatar is already cached in memory
  const cachedAvatar = organizationImageCache.get(orgName);
  if (cachedAvatar) {
    return cachedAvatar;
  }

  // If there's a pending fetch for this organization, wait for it to complete
  if (pendingFetches.has(orgName)) {
    return pendingFetches.get(orgName);
  }

  // Start the fetch process and store the promise in the pending fetches map
  // It will try to fetch from IndexedDB first, then from GitHub organizations, and finally from GitHub users, returning in the first successful step
  const fetchPromise = (async () => {
    // Step 1: Try to get the avatar from IndexedDB
    const avatarBlob = await getImageFromCache({ dbName: "GitHubAvatars", storeName: "ImageStore", orgName: `avatarUrl-${orgName}` });
    if (avatarBlob) {
      organizationImageCache.set(orgName, avatarBlob); // Cache it in memory
      return avatarBlob;
    }

    const octokit = new Octokit({ auth: await getGitHubAccessToken() });

    // Step 2: No avatar in IndexedDB, fetch from GitHub
    try {
      const {
        data: { avatar_url: avatarUrl },
      } = await octokit.rest.orgs.get({ org: orgName });

      if (avatarUrl) {
        const response = await fetch(avatarUrl);
        const blob = await response.blob();

        // Cache the fetched avatar in both memory and IndexedDB
        await saveImageToCache({
          dbName: "GitHubAvatars",
          storeName: "ImageStore",
          keyName: "name",
          orgName: `avatarUrl-${orgName}`,
          avatarBlob: blob,
        });

        organizationImageCache.set(orgName, blob);
        return blob;
      }
    } catch (orgError) {
      console.warn(`Failed to fetch avatar from organization ${orgName}: ${orgError}`);
    }

    // Step 3: Try fetching from GitHub users if the organization lookup failed
    try {
      const {
        data: { avatar_url: avatarUrl },
      } = await octokit.rest.users.getByUsername({ username: orgName });

      if (avatarUrl) {
        const response = await fetch(avatarUrl);
        const blob = await response.blob();

        // Cache the fetched avatar in both memory and IndexedDB
        await saveImageToCache({
          dbName: "GitHubAvatars",
          storeName: "ImageStore",
          keyName: "name",
          orgName: `avatarUrl-${orgName}`,
          avatarBlob: blob,
        });

        organizationImageCache.set(orgName, blob);
        return blob;
      }
    } catch (innerError) {
      renderErrorInModal(innerError as Error, `All tries failed to fetch avatar for ${orgName}: ${innerError}`);
    }
  })();

  pendingFetches.set(orgName, fetchPromise);

  // Wait for the fetch to complete
  try {
    return await fetchPromise;
  } finally {
    // Remove the pending fetch once it completes
    pendingFetches.delete(orgName);
  }
}
