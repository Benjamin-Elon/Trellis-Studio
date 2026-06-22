import 'dotenv/config';
import { notarize } from '@electron/notarize';

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  const appName = context.packager.appInfo.productFilename;
  const hasNotarizationSecrets = process.env.APPLEID && process.env.APPLEIDPASS && process.env.APPLE_TEAM_ID; // Trellis release: unsigned draft builds skip notarization.

  if (electronPlatformName !== 'darwin' || !hasNotarizationSecrets) {
    return;
  }

  return await notarize({
    tool: "notarytool",
    appBundleId: 'com.benjaminelon.trellisfordrawio',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS,
    teamId: process.env.APPLE_TEAM_ID
  });
};
