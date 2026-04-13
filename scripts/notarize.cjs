const path = require("node:path");
const { notarize } = require("@electron/notarize");

exports.default = async function notarizeApp(context) {
  if (process.platform !== "darwin") {
    return;
  }

  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn("[notarize] Skipping notarization. Missing APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID.");
    return;
  }

  console.log(`[notarize] Submitting ${appPath} for notarization`);

  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log("[notarize] Notarization complete");
};
